using System.Globalization;

namespace WinCCAlarmEditor.Core;

public static class ValueConvert
{
    public static bool TryParseDouble(string? text, out double value)
    {
        value = 0;
        if (string.IsNullOrWhiteSpace(text)) return false;
        text = text.Trim();
        return double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out value)
            || double.TryParse(text, NumberStyles.Float, CultureInfo.CurrentCulture, out value);
    }

    public static int ToInt(object? value) => value switch
    {
        null => 0,
        int i => i,
        long l => (int)l,
        double d => (int)Math.Round(d),
        bool b => b ? 1 : 0,
        string s when TryParseDouble(s, out var d) => (int)Math.Round(d),
        _ => 0,
    };

    public static string ToText(object? value) => value switch
    {
        null => string.Empty,
        string s => s,
        bool b => b ? "True" : "False",
        IFormattable f => f.ToString(null, CultureInfo.InvariantCulture),
        _ => value.ToString() ?? string.Empty,
    };
}
