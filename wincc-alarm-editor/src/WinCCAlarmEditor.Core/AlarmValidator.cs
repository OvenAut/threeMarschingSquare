using System.Text.RegularExpressions;

namespace WinCCAlarmEditor.Core;

public enum Severity { Error, Warning }

public sealed record ValidationIssue(Severity Severity, AlarmBase Alarm, string Sheet, string Message)
{
    public override string ToString() =>
        $"{(Severity == Severity.Error ? "Fehler" : "Warnung")} – {Sheet} \"{Alarm.Name}\" (ID {Alarm.Id}): {Message}";
}

/// <summary>Prüft die Meldungsliste auf typische Fehler, die beim Import ins TIA Portal auffallen würden.</summary>
public static class AlarmValidator
{
    private static readonly Regex ProblematicNameChars = new("[\"'\\\\/*?<>|:;,\\[\\]{}]");

    public const string DiscreteLabel = "Bitmeldung";
    public const string AnalogLabel = "Analogmeldung";

    public static List<ValidationIssue> Validate(AlarmDocument doc)
    {
        var issues = new List<ValidationIssue>();
        var language = doc.PrimaryLanguage;

        var discrete = doc.DiscreteAlarms.ToList();
        CheckCommon(discrete, DiscreteLabel, language, issues);
        foreach (var alarm in discrete)
        {
            if (alarm.TriggerBit < 0)
                issues.Add(new(Severity.Error, alarm, DiscreteLabel, "Trigger-Bit darf nicht negativ sein."));
            else if (alarm.TriggerBit > 31)
                issues.Add(new(Severity.Warning, alarm, DiscreteLabel, "Trigger-Bit größer als 31 – nur bei 64-Bit-Variablen möglich."));
        }
        foreach (var group in discrete.Where(a => a.TriggerTag.Length > 0)
                     .GroupBy(a => (Tag: a.TriggerTag.ToLowerInvariant(), a.TriggerBit)).Where(g => g.Count() > 1))
        {
            foreach (var alarm in group)
                issues.Add(new(Severity.Warning, alarm, DiscreteLabel,
                    $"{alarm.TriggerTag} Bit {alarm.TriggerBit} wird von {group.Count()} Meldungen verwendet."));
        }

        var analog = doc.AnalogAlarms.ToList();
        CheckCommon(analog, AnalogLabel, language, issues);
        foreach (var alarm in analog)
        {
            if (string.IsNullOrWhiteSpace(alarm.Limit))
                issues.Add(new(Severity.Error, alarm, AnalogLabel, "Kein Grenzwert angegeben."));
            if (string.IsNullOrWhiteSpace(alarm.LimitMode))
                issues.Add(new(Severity.Warning, alarm, AnalogLabel, "Kein Grenzwertmodus angegeben."));
        }

        foreach (var alarm in discrete.Cast<AlarmBase>().Concat(analog))
        {
            alarm.Issue = string.Join(Environment.NewLine,
                issues.Where(i => ReferenceEquals(i.Alarm, alarm)).Select(i => i.Message));
        }
        return issues;
    }

    private static void CheckCommon<T>(IReadOnlyList<T> alarms, string sheet, string language, List<ValidationIssue> issues)
        where T : AlarmBase
    {
        foreach (var group in alarms.GroupBy(a => a.Id).Where(g => g.Count() > 1))
            foreach (var alarm in group)
                issues.Add(new(Severity.Error, alarm, sheet, $"ID {alarm.Id} ist mehrfach vergeben."));

        foreach (var group in alarms.Where(a => a.Name.Length > 0)
                     .GroupBy(a => a.Name, StringComparer.OrdinalIgnoreCase).Where(g => g.Count() > 1))
            foreach (var alarm in group)
                issues.Add(new(Severity.Error, alarm, sheet, $"Name \"{alarm.Name}\" ist mehrfach vergeben."));

        foreach (var alarm in alarms)
        {
            if (alarm.Id <= 0)
                issues.Add(new(Severity.Error, alarm, sheet, "ID muss größer als 0 sein."));
            if (string.IsNullOrWhiteSpace(alarm.Name))
                issues.Add(new(Severity.Error, alarm, sheet, "Kein Name angegeben."));
            else if (ProblematicNameChars.IsMatch(alarm.Name))
                issues.Add(new(Severity.Warning, alarm, sheet, "Name enthält Sonderzeichen, die beim Import Probleme machen können."));
            if (string.IsNullOrWhiteSpace(alarm.TriggerTag))
                issues.Add(new(Severity.Error, alarm, sheet, "Keine Trigger-Variable angegeben."));
            if (string.IsNullOrWhiteSpace(alarm.Texts[language]))
                issues.Add(new(Severity.Warning, alarm, sheet, $"Kein Meldetext ({language})."));
            if (string.IsNullOrWhiteSpace(alarm.AlarmClass))
                issues.Add(new(Severity.Warning, alarm, sheet, "Keine Meldeklasse angegeben."));
        }
    }
}
