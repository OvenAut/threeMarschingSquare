namespace WinCCAlarmEditor.Core;

/// <summary>Spaltenaufbau eines Tabellenblatts, wie er beim Öffnen vorgefunden wurde.</summary>
public sealed class SheetLayout
{
    public string SheetName { get; init; } = string.Empty;

    /// <summary>Spaltenüberschriften in Originalreihenfolge (leere Überschrift = Spalte wird ignoriert).</summary>
    public List<string> Headers { get; } = new();

    /// <summary>Werte unbekannter Spalten, die in allen vorhandenen Zeilen gleich sind – Vorgabe für neue Meldungen.</summary>
    public Dictionary<string, object?> Defaults { get; } = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>Spalten, in denen die Originaldatei Zahlen als Text gespeichert hat.</summary>
    public HashSet<string> TextTypedColumns { get; } = new(StringComparer.OrdinalIgnoreCase);

    public static SheetLayout CreateDefault(string sheetName, IReadOnlyList<FieldDef> fields,
        IReadOnlyList<string> order, IEnumerable<string> languages)
    {
        var layout = new SheetLayout { SheetName = sheetName };
        var langs = languages.ToList();
        foreach (var key in order)
        {
            layout.Headers.Add(fields.First(f => f.Key == key).DefaultHeader);
            if (key == nameof(AlarmBase.Name))
                layout.Headers.AddRange(langs.Select(AlarmSchema.TextHeaderFor));
        }
        layout.Headers.AddRange(langs.Select(AlarmSchema.InfoHeaderFor));
        return layout;
    }
}
