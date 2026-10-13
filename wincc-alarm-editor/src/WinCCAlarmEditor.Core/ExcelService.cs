using ClosedXML.Excel;

namespace WinCCAlarmEditor.Core;

/// <summary>
/// Liest und schreibt Meldungslisten im Excel-Format des TIA-Portal-Meldungsexports
/// (Blätter "DiscreteAlarms" und "AnalogAlarms", eine Überschriftenzeile, eine Meldung pro Zeile).
/// </summary>
public static class ExcelService
{
    public static AlarmDocument Load(string path)
    {
        using var stream = new MemoryStream(File.ReadAllBytes(path));
        using var workbook = new XLWorkbook(stream);

        var discrete = FindSheet(workbook, AlarmSchema.DiscreteSheet, "discrete");
        var analog = FindSheet(workbook, AlarmSchema.AnalogSheet, "analog");
        if (discrete is null && analog is null)
        {
            throw new InvalidDataException(
                $"Die Datei enthält weder ein Blatt \"{AlarmSchema.DiscreteSheet}\" noch \"{AlarmSchema.AnalogSheet}\".\n" +
                "Bitte eine Meldungs-Exportdatei aus dem TIA Portal (HMI-Meldungen → Exportieren) verwenden.");
        }

        var doc = new AlarmDocument { FilePath = path };
        var languages = new List<string>();
        if (discrete is not null)
            doc.DiscreteLayout = ReadSheet(discrete, AlarmSchema.Discrete, () => new DiscreteAlarm(), doc.DiscreteAlarms, languages);
        if (analog is not null)
            doc.AnalogLayout = ReadSheet(analog, AlarmSchema.Analog, () => new AnalogAlarm(), doc.AnalogAlarms, languages);

        foreach (var language in languages) doc.Languages.Add(language);
        if (doc.Languages.Count == 0) doc.Languages.Add("de-DE");
        return doc;
    }

    public static void Save(AlarmDocument doc, string path)
    {
        // Die zuletzt geöffnete Datei dient als Vorlage: andere Blätter und Formatierungen bleiben erhalten.
        var template = doc.FilePath is not null && File.Exists(doc.FilePath) ? File.ReadAllBytes(doc.FilePath) : null;
        using (var workbook = template is null ? new XLWorkbook() : new XLWorkbook(new MemoryStream(template)))
        {
            var writeDiscrete = doc.DiscreteLayout is not null || doc.DiscreteAlarms.Count > 0 || doc.AnalogAlarms.Count == 0;
            var writeAnalog = doc.AnalogLayout is not null || doc.AnalogAlarms.Count > 0;

            if (writeDiscrete)
            {
                doc.DiscreteLayout ??= SheetLayout.CreateDefault(AlarmSchema.DiscreteSheet, AlarmSchema.Discrete, AlarmSchema.DiscreteOrder, doc.Languages);
                WriteSheet(workbook, doc.DiscreteLayout, AlarmSchema.Discrete, doc.DiscreteAlarms, doc.Languages);
            }
            if (writeAnalog)
            {
                doc.AnalogLayout ??= SheetLayout.CreateDefault(AlarmSchema.AnalogSheet, AlarmSchema.Analog, AlarmSchema.AnalogOrder, doc.Languages);
                WriteSheet(workbook, doc.AnalogLayout, AlarmSchema.Analog, doc.AnalogAlarms, doc.Languages);
            }

            workbook.SaveAs(path);
        }
        doc.FilePath = path;
    }

    private static IXLWorksheet? FindSheet(XLWorkbook workbook, string name, string fragment) =>
        workbook.Worksheets.FirstOrDefault(w => w.Name.Equals(name, StringComparison.OrdinalIgnoreCase))
        ?? workbook.Worksheets.FirstOrDefault(w => w.Name.Contains(fragment, StringComparison.OrdinalIgnoreCase));

    private static SheetLayout ReadSheet<T>(IXLWorksheet sheet, IReadOnlyList<FieldDef> fields, Func<T> create,
        ICollection<T> target, List<string> languages) where T : AlarmBase
    {
        var layout = new SheetLayout { SheetName = sheet.Name };
        var lastColumn = sheet.LastColumnUsed()?.ColumnNumber() ?? 0;
        var lastRow = sheet.LastRowUsed()?.RowNumber() ?? 0;

        var columns = new List<ColumnInfo>();
        for (var c = 1; c <= lastColumn; c++)
        {
            var header = sheet.Cell(1, c).GetFormattedString().Trim();
            layout.Headers.Add(header);
            var column = AlarmSchema.Classify(header, fields);
            columns.Add(column);
            if (column.Language is { } language && !languages.Contains(language, StringComparer.OrdinalIgnoreCase))
                languages.Add(language);
        }

        var alarms = new List<T>();
        for (var r = 2; r <= lastRow; r++)
        {
            if (sheet.Row(r).IsEmpty()) continue;
            var alarm = create();
            for (var c = 1; c <= lastColumn; c++)
            {
                var column = columns[c - 1];
                if (column.Header.Length == 0) continue;
                var cell = sheet.Cell(r, c);
                var raw = ReadCell(cell);
                if (alarms.Count == 0 && cell.Value.Type == XLDataType.Text)
                    layout.TextTypedColumns.Add(column.Header);

                switch (column.Kind)
                {
                    case ColumnKind.Field: alarm.SetField(column.Key, raw); break;
                    case ColumnKind.Text: alarm.Texts[column.Language!] = ValueConvert.ToText(raw); break;
                    case ColumnKind.InfoText: alarm.InfoTexts[column.Language!] = ValueConvert.ToText(raw); break;
                    default: alarm.Extra[column.Header] = raw; break;
                }
            }
            alarms.Add(alarm);
        }

        // Unbekannte Spalten mit überall gleichem Wert (z. B. Einstellungen) werden für neue Meldungen übernommen.
        if (alarms.Count > 0)
        {
            foreach (var column in columns.Where(c => c.Kind == ColumnKind.Extra && c.Header.Length > 0))
            {
                var first = alarms[0].Extra.GetValueOrDefault(column.Header);
                if (alarms.All(a => Equals(a.Extra.GetValueOrDefault(column.Header), first)))
                    layout.Defaults[column.Header] = first;
            }
        }

        foreach (var alarm in alarms) target.Add(alarm);
        return layout;
    }

    private static void WriteSheet<T>(XLWorkbook workbook, SheetLayout layout, IReadOnlyList<FieldDef> fields,
        IEnumerable<T> alarms, IEnumerable<string> languages) where T : AlarmBase
    {
        var sheet = workbook.Worksheets.FirstOrDefault(w => w.Name.Equals(layout.SheetName, StringComparison.OrdinalIgnoreCase));
        var isNewSheet = sheet is null;
        sheet ??= workbook.Worksheets.Add(layout.SheetName);

        AddMissingLanguageColumns(layout, fields, languages);
        var columns = layout.Headers.Select(h => AlarmSchema.Classify(h, fields)).ToList();
        var numericFields = fields.Where(f => f.Numeric).Select(f => f.Key).ToHashSet();

        var lastRow = sheet.LastRowUsed()?.RowNumber() ?? 0;
        if (lastRow >= 2) sheet.Rows(2, lastRow).Delete();

        for (var c = 0; c < columns.Count; c++)
            sheet.Cell(1, c + 1).Value = columns[c].Header;

        var row = 2;
        foreach (var alarm in alarms)
        {
            for (var c = 0; c < columns.Count; c++)
            {
                var column = columns[c];
                if (column.Header.Length == 0) continue;
                var value = column.Kind switch
                {
                    ColumnKind.Field => alarm.GetField(column.Key),
                    ColumnKind.Text => alarm.Texts[column.Language!],
                    ColumnKind.InfoText => alarm.InfoTexts[column.Language!],
                    _ => alarm.Extra.GetValueOrDefault(column.Header),
                };
                var asNumber = column.Kind == ColumnKind.Field && numericFields.Contains(column.Key)
                    && !layout.TextTypedColumns.Contains(column.Header);
                WriteCell(sheet.Cell(row, c + 1), value, asNumber);
            }
            row++;
        }

        if (isNewSheet)
        {
            sheet.Row(1).Style.Font.Bold = true;
            sheet.SheetView.FreezeRows(1);
            sheet.Columns(1, columns.Count).Width = 18;
        }
    }

    /// <summary>Hängt Text-Spalten für Sprachen an, die in der Vorlage noch fehlen.</summary>
    private static void AddMissingLanguageColumns(SheetLayout layout, IReadOnlyList<FieldDef> fields, IEnumerable<string> languages)
    {
        var columns = layout.Headers.Select(h => AlarmSchema.Classify(h, fields)).ToList();
        foreach (var kind in new[] { ColumnKind.Text, ColumnKind.InfoText })
        {
            var existing = columns.Where(c => c.Kind == kind).ToList();
            // Infotext-Spalten nur ergänzen, wenn die Vorlage überhaupt welche hat.
            if (kind == ColumnKind.InfoText && existing.Count == 0) continue;
            foreach (var language in languages)
            {
                if (existing.Any(c => string.Equals(c.Language, language, StringComparison.OrdinalIgnoreCase))) continue;
                var header = existing.Count > 0
                    ? AlarmSchema.ReplaceLanguage(existing[0].Header, language)
                    : AlarmSchema.TextHeaderFor(language);
                layout.Headers.Add(header);
            }
        }
    }

    private static object? ReadCell(IXLCell cell)
    {
        var value = cell.Value;
        return value.Type switch
        {
            XLDataType.Blank => null,
            XLDataType.Boolean => value.GetBoolean(),
            XLDataType.Number => value.GetNumber(),
            XLDataType.Text => value.GetText(),
            XLDataType.DateTime => value.GetDateTime(),
            XLDataType.TimeSpan => value.GetTimeSpan(),
            _ => cell.GetFormattedString(),
        };
    }

    private static void WriteCell(IXLCell cell, object? value, bool asNumber)
    {
        switch (value)
        {
            case null:
            case string { Length: 0 }:
                cell.Value = Blank.Value;
                break;
            case string s when asNumber && ValueConvert.TryParseDouble(s, out var number):
                cell.Value = number;
                break;
            case string s:
                cell.Value = s;
                break;
            case int i:
                if (asNumber) cell.Value = (double)i;
                else cell.Value = ValueConvert.ToText(i);
                break;
            case double d:
                cell.Value = d;
                break;
            case bool b:
                cell.Value = b;
                break;
            case DateTime dt:
                cell.Value = dt;
                break;
            case TimeSpan ts:
                cell.Value = ts;
                break;
            default:
                cell.Value = ValueConvert.ToText(value);
                break;
        }
    }
}
