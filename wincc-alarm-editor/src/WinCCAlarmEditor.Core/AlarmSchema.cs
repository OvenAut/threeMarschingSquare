using System.Text.RegularExpressions;

namespace WinCCAlarmEditor.Core;

public enum ColumnKind { Field, Text, InfoText, Extra }

/// <summary>Bedeutung einer Spalte in der Exportdatei.</summary>
public sealed record ColumnInfo(string Header, ColumnKind Kind, string Key, string? Language);

/// <summary>Bekanntes Feld: Eigenschaftsname, Standard-Spaltenüberschrift und weitere erkannte Überschriften.</summary>
public sealed record FieldDef(string Key, string DefaultHeader, bool Numeric, params string[] Aliases);

/// <summary>
/// Spaltenaufbau der Meldungs-Exportdatei (HMI-Meldungen → Exportieren im TIA Portal).
/// Wird eine eigene Exportdatei geöffnet, gelten deren Überschriften; die Standardüberschriften
/// werden nur für komplett neue Dateien benutzt.
/// </summary>
public static class AlarmSchema
{
    public const string DiscreteSheet = "DiscreteAlarms";
    public const string AnalogSheet = "AnalogAlarms";

    private static readonly FieldDef[] Common =
    {
        new(nameof(AlarmBase.Id), "ID", true, "Id", "Nummer"),
        new(nameof(AlarmBase.Name), "Name", false),
        new(nameof(AlarmBase.AlarmClass), "Alarm class", false, "Class", "Meldeklasse", "Klasse"),
        new(nameof(AlarmBase.TriggerTag), "Trigger tag", false, "Triggervariable", "Trigger-Variable"),
        new(nameof(AlarmBase.Priority), "Priority", true, "Priorität"),
        new(nameof(AlarmBase.Origin), "Origin", false, "Herkunft"),
        new(nameof(AlarmBase.Area), "Area", false, "Bereich"),
    };

    public static readonly IReadOnlyList<FieldDef> Discrete = Common.Concat(new FieldDef[]
    {
        new(nameof(DiscreteAlarm.TriggerBit), "Trigger bit", true, "Triggerbit", "Trigger-Bit"),
        new(nameof(DiscreteAlarm.TriggerMode), "Trigger mode", false, "Triggermodus"),
        new(nameof(DiscreteAlarm.AckTag), "Acknowledgment tag", false, "Acknowledgement tag", "Quittiervariable"),
        new(nameof(DiscreteAlarm.AckBit), "Acknowledgment bit", true, "Acknowledgement bit", "Quittierbit"),
    }).ToArray();

    public static readonly IReadOnlyList<FieldDef> Analog = Common.Concat(new FieldDef[]
    {
        new(nameof(AnalogAlarm.Limit), "Limit", true, "Grenzwert"),
        new(nameof(AnalogAlarm.LimitMode), "Limit mode", false, "Grenzwertmodus"),
    }).ToArray();

    /// <summary>Spaltenreihenfolge neuer Dateien (Texte werden nach "Name" eingefügt, Infotexte am Ende).</summary>
    public static readonly IReadOnlyList<string> DiscreteOrder = new[]
    {
        nameof(AlarmBase.Id), nameof(AlarmBase.Name), nameof(AlarmBase.AlarmClass),
        nameof(AlarmBase.TriggerTag), nameof(DiscreteAlarm.TriggerBit), nameof(DiscreteAlarm.TriggerMode),
        nameof(DiscreteAlarm.AckTag), nameof(DiscreteAlarm.AckBit),
        nameof(AlarmBase.Priority), nameof(AlarmBase.Origin), nameof(AlarmBase.Area),
    };

    public static readonly IReadOnlyList<string> AnalogOrder = new[]
    {
        nameof(AlarmBase.Id), nameof(AlarmBase.Name), nameof(AlarmBase.AlarmClass),
        nameof(AlarmBase.TriggerTag), nameof(AnalogAlarm.Limit), nameof(AnalogAlarm.LimitMode),
        nameof(AlarmBase.Priority), nameof(AlarmBase.Origin), nameof(AlarmBase.Area),
    };

    private static readonly Regex TextHeader = new(
        @"^\s*(?<kind>alarm\s*text|event\s*text|meldetext|info\s*text|infotext)\s*\[(?<lang>[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*)\]",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    private static readonly Regex LanguageTag = new(@"\[[^\]]+\]");

    public static ColumnInfo Classify(string header, IReadOnlyList<FieldDef> fields)
    {
        var match = TextHeader.Match(header);
        if (match.Success)
        {
            var isInfo = match.Groups["kind"].Value.StartsWith("info", StringComparison.OrdinalIgnoreCase);
            return new ColumnInfo(header, isInfo ? ColumnKind.InfoText : ColumnKind.Text, string.Empty, match.Groups["lang"].Value);
        }

        var normalized = Normalize(header);
        foreach (var field in fields)
        {
            if (Normalize(field.DefaultHeader) == normalized || field.Aliases.Any(a => Normalize(a) == normalized))
                return new ColumnInfo(header, ColumnKind.Field, field.Key, null);
        }
        return new ColumnInfo(header, ColumnKind.Extra, header, null);
    }

    public static string Normalize(string text) =>
        Regex.Replace(text.Trim().ToLowerInvariant(), @"\s+", " ");

    public static string TextHeaderFor(string language) => $"Alarm text [{language}], Alarm text";

    public static string InfoHeaderFor(string language) => $"Info text [{language}], Info text";

    /// <summary>Ersetzt die Sprachkennung in eckigen Klammern, z. B. "Alarm text [de-DE], …" → "[en-US]".</summary>
    public static string ReplaceLanguage(string header, string language) =>
        LanguageTag.Replace(header, $"[{language}]", 1);
}
