namespace WinCCAlarmEditor.Core;

/// <summary>Analogmeldung (Blatt "AnalogAlarms").</summary>
public sealed class AnalogAlarm : AlarmBase
{
    private string _limit = string.Empty;
    private string _limitMode = string.Empty;

    /// <summary>Grenzwert: Konstante oder Variablenname.</summary>
    public string Limit { get => _limit; set => Set(ref _limit, value ?? string.Empty); }
    public string LimitMode { get => _limitMode; set => Set(ref _limitMode, value ?? string.Empty); }

    public override object? GetField(string key) => key switch
    {
        nameof(Limit) => Limit,
        nameof(LimitMode) => LimitMode,
        _ => base.GetField(key),
    };

    public override bool SetField(string key, object? value)
    {
        switch (key)
        {
            case nameof(Limit): Limit = ValueConvert.ToText(value); return true;
            case nameof(LimitMode): LimitMode = ValueConvert.ToText(value); return true;
            default: return base.SetField(key, value);
        }
    }

    public override AlarmBase CloneAlarm()
    {
        var copy = new AnalogAlarm { Limit = Limit, LimitMode = LimitMode };
        CopyTo(copy);
        return copy;
    }
}
