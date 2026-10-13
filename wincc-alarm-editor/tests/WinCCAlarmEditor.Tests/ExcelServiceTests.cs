using ClosedXML.Excel;
using WinCCAlarmEditor.Core;

namespace WinCCAlarmEditor.Tests;

public sealed class ExcelServiceTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "wincc-alarm-tests-" + Guid.NewGuid().ToString("N"));

    public ExcelServiceTests() => Directory.CreateDirectory(_dir);

    public void Dispose() => Directory.Delete(_dir, true);

    [Fact]
    public void NewDocument_RoundTrips()
    {
        var doc = AlarmDocument.CreateNew();
        var d = doc.NewDiscrete();
        d.TriggerTag = "Alarmwort_0";
        d.TriggerBit = 3;
        d.Texts["de-DE"] = "Motor 1 Übertemperatur";
        d.InfoTexts["de-DE"] = "Lüfter prüfen";
        d.AlarmClass = "Warning";
        doc.DiscreteAlarms.Add(d);

        var a = doc.NewAnalog();
        a.TriggerTag = "Druck";
        a.Limit = "12.5";
        a.LimitMode = "Higher";
        a.Texts["de-DE"] = "Druck zu hoch";
        doc.AnalogAlarms.Add(a);

        var path = Path.Combine(_dir, "neu.xlsx");
        ExcelService.Save(doc, path);
        var loaded = ExcelService.Load(path);

        Assert.Equal(new[] { "de-DE" }, loaded.Languages);
        var ld = Assert.Single(loaded.DiscreteAlarms);
        Assert.Equal(1, ld.Id);
        Assert.Equal("Alarm_1", ld.Name);
        Assert.Equal("Alarmwort_0", ld.TriggerTag);
        Assert.Equal(3, ld.TriggerBit);
        Assert.Equal("Motor 1 Übertemperatur", ld.Texts["de-DE"]);
        Assert.Equal("Lüfter prüfen", ld.InfoTexts["de-DE"]);
        Assert.Equal("Warning", ld.AlarmClass);

        var la = Assert.Single(loaded.AnalogAlarms);
        Assert.Equal("Druck", la.TriggerTag);
        Assert.Equal(12.5, double.Parse(la.Limit, System.Globalization.CultureInfo.InvariantCulture));
        Assert.Equal("Higher", la.LimitMode);

        using var wb = new XLWorkbook(path);
        var ws = wb.Worksheet(AlarmSchema.DiscreteSheet);
        Assert.Equal("ID", ws.Cell(1, 1).GetString());
        Assert.Equal(XLDataType.Number, ws.Cell(2, 1).Value.Type);
    }

    [Fact]
    public void TemplateColumnsSheetsAndTextTypesArePreserved()
    {
        var template = Path.Combine(_dir, "export.xlsx");
        using (var wb = new XLWorkbook())
        {
            var ws = wb.AddWorksheet("DiscreteAlarms");
            string[] headers = { "ID", "Name", "Event text [de-DE], Alarm text", "Class", "Trigger tag", "Trigger bit", "Single acknowledgment", "Additional text 1 [de-DE], Alarm parameter 1" };
            for (var c = 0; c < headers.Length; c++) ws.Cell(1, c + 1).Value = headers[c];
            object[][] rows =
            {
                new object[] { "7", "Pumpe_Stoerung", "Pumpe gestört", "Alarm", "HMI_Alarme[0]", "0", "False", "Halle 1" },
                new object[] { "8", "Pumpe_Trocken", "Pumpe läuft trocken", "Alarm", "HMI_Alarme[0]", "1", "False", "Halle 2" },
            };
            for (var r = 0; r < rows.Length; r++)
                for (var c = 0; c < rows[r].Length; c++)
                    ws.Cell(r + 2, c + 1).Value = (string)rows[r][c];
            wb.AddWorksheet("Info").Cell(1, 1).Value = "bleibt erhalten";
            wb.SaveAs(template);
        }

        var doc = ExcelService.Load(template);
        Assert.Equal(2, doc.DiscreteAlarms.Count);
        Assert.Equal(7, doc.DiscreteAlarms[0].Id);
        Assert.Equal(1, doc.DiscreteAlarms[1].TriggerBit);
        Assert.Equal("Pumpe gestört", doc.DiscreteAlarms[0].Texts["de-DE"]);
        Assert.Equal("Halle 1", doc.DiscreteAlarms[0].Extra["Additional text 1 [de-DE], Alarm parameter 1"]);

        var added = doc.NewDiscrete();
        Assert.Equal(9, added.Id);
        added.TriggerTag = "HMI_Alarme[0]";
        added.TriggerBit = 2;
        added.Texts["de-DE"] = "Neu";
        doc.DiscreteAlarms.Add(added);
        doc.Languages.Add("en-US");
        added.Texts["en-US"] = "New";

        var output = Path.Combine(_dir, "ausgabe.xlsx");
        ExcelService.Save(doc, output);

        using var result = new XLWorkbook(output);
        Assert.Equal("bleibt erhalten", result.Worksheet("Info").Cell(1, 1).GetString());
        var sheet = result.Worksheet("DiscreteAlarms");
        Assert.Equal("Single acknowledgment", sheet.Cell(1, 7).GetString());
        Assert.Equal("Event text [en-US], Alarm text", sheet.Cell(1, 9).GetString());
        // ID war in der Vorlage als Text gespeichert → bleibt Text
        Assert.Equal(XLDataType.Text, sheet.Cell(4, 1).Value.Type);
        Assert.Equal("9", sheet.Cell(4, 1).GetString());
        // gemeinsamer Wert der unbekannten Spalte wird für neue Meldungen übernommen …
        Assert.Equal("False", sheet.Cell(4, 7).GetString());
        // … unterschiedliche Werte dagegen nicht
        Assert.Equal("Halle 2", sheet.Cell(3, 8).GetString());
        Assert.True(sheet.Cell(4, 8).IsEmpty());
        Assert.Equal("New", sheet.Cell(4, 9).GetString());
        Assert.Equal(4, sheet.LastRowUsed()!.RowNumber());
        Assert.False(result.Worksheets.Contains("AnalogAlarms"));
    }

    [Fact]
    public void SavingFewerRowsRemovesOldRows()
    {
        var doc = AlarmDocument.CreateNew();
        for (var i = 0; i < 5; i++)
        {
            var alarm = doc.NewDiscrete();
            alarm.TriggerTag = "T";
            alarm.TriggerBit = i;
            doc.DiscreteAlarms.Add(alarm);
        }
        var path = Path.Combine(_dir, "kuerzer.xlsx");
        ExcelService.Save(doc, path);
        doc.DiscreteAlarms.RemoveAt(4);
        doc.DiscreteAlarms.RemoveAt(3);
        ExcelService.Save(doc, path);

        Assert.Equal(3, ExcelService.Load(path).DiscreteAlarms.Count);
    }

    [Fact]
    public void FileWithoutAlarmSheetsIsRejected()
    {
        var path = Path.Combine(_dir, "falsch.xlsx");
        using (var wb = new XLWorkbook())
        {
            wb.AddWorksheet("Tabelle1").Cell(1, 1).Value = "x";
            wb.SaveAs(path);
        }
        Assert.Throws<InvalidDataException>(() => ExcelService.Load(path));
    }
}
