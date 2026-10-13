using System.Globalization;
using System.Text.RegularExpressions;

namespace WinCCAlarmEditor.Core;

public sealed class SeriesOptions
{
    public int Count { get; set; } = 16;
    public int StartId { get; set; } = 1;
    public string NamePattern { get; set; } = "Alarm_{id}";
    /// <summary>Trigger-Variable; {w} wird durch den Index der Variable ersetzt, z. B. "HMI_Alarme[{w}]".</summary>
    public string TagPattern { get; set; } = "Alarmwort_{w}";
    public int StartWord { get; set; }
    public int BitsPerTag { get; set; } = 16;
    public int StartBit { get; set; }
    public string TextPattern { get; set; } = "Störung {n}";
    /// <summary>Optional: ein Meldetext pro Meldung (überschreibt das Text-Muster, leere Zeilen nicht).</summary>
    public IReadOnlyList<string> Texts { get; set; } = Array.Empty<string>();
    public string AlarmClass { get; set; } = "Alarm";
    public string Language { get; set; } = "de-DE";
}

/// <summary>
/// Erzeugt fortlaufende Bitmeldungen. Platzhalter in Name, Variable und Text:
/// {n} laufende Nummer ab 1, {id} Meldungs-ID, {w} Variablen-Index, {bit} Bitnummer.
/// Formatangaben sind möglich, z. B. {n:000} → 001.
/// </summary>
public static class SeriesGenerator
{
    private static readonly Regex Placeholder = new(@"\{(n|id|w|bit)(?::([^}]+))?\}", RegexOptions.IgnoreCase);

    public static List<DiscreteAlarm> Generate(SeriesOptions options)
    {
        if (options.BitsPerTag <= 0) throw new ArgumentOutOfRangeException(nameof(options), "Bits pro Variable muss größer als 0 sein.");

        var result = new List<DiscreteAlarm>(options.Count);
        for (var i = 0; i < options.Count; i++)
        {
            var absoluteBit = options.StartBit + i;
            var word = options.StartWord + absoluteBit / options.BitsPerTag;
            var bit = absoluteBit % options.BitsPerTag;
            var n = i + 1;
            var id = options.StartId + i;

            var textPattern = i < options.Texts.Count && !string.IsNullOrWhiteSpace(options.Texts[i])
                ? options.Texts[i].Trim()
                : options.TextPattern;

            var alarm = new DiscreteAlarm
            {
                Id = id,
                Name = Format(options.NamePattern, n, id, word, bit),
                TriggerTag = Format(options.TagPattern, n, id, word, bit),
                TriggerBit = bit,
                AlarmClass = options.AlarmClass,
            };
            alarm.Texts[options.Language] = Format(textPattern, n, id, word, bit);
            result.Add(alarm);
        }
        return result;
    }

    public static string Format(string pattern, int n, int id, int word, int bit) =>
        Placeholder.Replace(pattern, match =>
        {
            var value = match.Groups[1].Value.ToLowerInvariant() switch
            {
                "n" => n,
                "id" => id,
                "w" => word,
                _ => bit,
            };
            var format = match.Groups[2].Success ? match.Groups[2].Value : null;
            return value.ToString(format, CultureInfo.InvariantCulture);
        });
}
