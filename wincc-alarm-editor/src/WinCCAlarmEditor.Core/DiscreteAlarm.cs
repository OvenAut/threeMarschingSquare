namespace WinCCAlarmEditor.Core;

/// <summary>Bitmeldung (Blatt "DiscreteAlarms").</summary>
public sealed class DiscreteAlarm : AlarmBase
{
    private int _triggerBit;
    private string _triggerMode = string.Empty;
    private string _ackTag = string.Empty;
    private string _ackBit = string.Empty;

    public int TriggerBit { get => _triggerBit; set => Set(ref _triggerBit, value); }
    public string TriggerMode { get => _triggerMode; set => Set(ref _triggerMode, value ?? string.Empty); }
    public string AckTag { get => _ackTag; set => Set(ref _ackTag, value ?? string.Empty); }
    public string AckBit { get => _ackBit; set => Set(ref _ackBit, value ?? string.Empty); }

    public override object? GetField(string key) => key switch
    {
        nameof(TriggerBit) => TriggerBit,
        nameof(TriggerMode) => TriggerMode,
        nameof(AckTag) => AckTag,
        nameof(AckBit) => AckBit,
        _ => base.GetField(key),
    };

    public override bool SetField(string key, object? value)
    {
        switch (key)
        {
            case nameof(TriggerBit): TriggerBit = ValueConvert.ToInt(value); return true;
            case nameof(TriggerMode): TriggerMode = ValueConvert.ToText(value); return true;
            case nameof(AckTag): AckTag = ValueConvert.ToText(value); return true;
            case nameof(AckBit): AckBit = ValueConvert.ToText(value); return true;
            default: return base.SetField(key, value);
        }
    }

    public override AlarmBase CloneAlarm()
    {
        var copy = new DiscreteAlarm
        {
            TriggerBit = TriggerBit,
            TriggerMode = TriggerMode,
            AckTag = AckTag,
            AckBit = AckBit,
        };
        CopyTo(copy);
        return copy;
    }
}
