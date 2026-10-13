using System.Text.RegularExpressions;

namespace WinCCAlarmEditor.Core;

/// <summary>Gemeinsame Eigenschaften von Bit- und Analogmeldungen.</summary>
public abstract class AlarmBase : ObservableObject
{
    private static readonly Regex IndexedPath = new(@"^(Texts|InfoTexts)\[(.+)\]$");

    private int _id;
    private string _name = string.Empty;
    private string _alarmClass = "Alarm";
    private string _triggerTag = string.Empty;
    private string _priority = string.Empty;
    private string _origin = string.Empty;
    private string _area = string.Empty;
    private string _issue = string.Empty;

    protected AlarmBase()
    {
        Texts.PropertyChanged += (_, _) => OnPropertyChanged(nameof(Texts));
        InfoTexts.PropertyChanged += (_, _) => OnPropertyChanged(nameof(InfoTexts));
    }

    public int Id { get => _id; set => Set(ref _id, value); }
    public string Name { get => _name; set => Set(ref _name, value ?? string.Empty); }
    public string AlarmClass { get => _alarmClass; set => Set(ref _alarmClass, value ?? string.Empty); }
    public string TriggerTag { get => _triggerTag; set => Set(ref _triggerTag, value ?? string.Empty); }
    public string Priority { get => _priority; set => Set(ref _priority, value ?? string.Empty); }
    public string Origin { get => _origin; set => Set(ref _origin, value ?? string.Empty); }
    public string Area { get => _area; set => Set(ref _area, value ?? string.Empty); }

    /// <summary>Meldetext je Sprache.</summary>
    public LocalizedTexts Texts { get; } = new();

    /// <summary>Infotext je Sprache.</summary>
    public LocalizedTexts InfoTexts { get; } = new();

    /// <summary>Spalten der Exportdatei, die der Editor nicht kennt – werden unverändert zurückgeschrieben.</summary>
    public Dictionary<string, object?> Extra { get; } = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>Ergebnis der letzten Prüfung (leer = in Ordnung).</summary>
    public string Issue
    {
        get => _issue;
        set
        {
            if (Set(ref _issue, value ?? string.Empty)) OnPropertyChanged(nameof(HasIssue));
        }
    }

    public bool HasIssue => _issue.Length > 0;

    public virtual object? GetField(string key) => key switch
    {
        nameof(Id) => Id,
        nameof(Name) => Name,
        nameof(AlarmClass) => AlarmClass,
        nameof(TriggerTag) => TriggerTag,
        nameof(Priority) => Priority,
        nameof(Origin) => Origin,
        nameof(Area) => Area,
        _ => null,
    };

    public virtual bool SetField(string key, object? value)
    {
        switch (key)
        {
            case nameof(Id): Id = ValueConvert.ToInt(value); return true;
            case nameof(Name): Name = ValueConvert.ToText(value); return true;
            case nameof(AlarmClass): AlarmClass = ValueConvert.ToText(value); return true;
            case nameof(TriggerTag): TriggerTag = ValueConvert.ToText(value); return true;
            case nameof(Priority): Priority = ValueConvert.ToText(value); return true;
            case nameof(Origin): Origin = ValueConvert.ToText(value); return true;
            case nameof(Area): Area = ValueConvert.ToText(value); return true;
            default: return false;
        }
    }

    /// <summary>Setzt einen Wert über den Binding-Pfad einer Tabellenspalte (z. B. "TriggerBit" oder "Texts[de-DE]").</summary>
    public void SetByPath(string path, string value)
    {
        var match = IndexedPath.Match(path);
        if (!match.Success)
        {
            SetField(path, value);
            return;
        }
        var texts = match.Groups[1].Value == nameof(InfoTexts) ? InfoTexts : Texts;
        texts[match.Groups[2].Value] = value;
    }

    public abstract AlarmBase CloneAlarm();

    protected void CopyTo(AlarmBase target)
    {
        target.Id = Id;
        target.Name = Name;
        target.AlarmClass = AlarmClass;
        target.TriggerTag = TriggerTag;
        target.Priority = Priority;
        target.Origin = Origin;
        target.Area = Area;
        target.Texts.CopyFrom(Texts);
        target.InfoTexts.CopyFrom(InfoTexts);
        foreach (var (key, value) in Extra) target.Extra[key] = value;
    }
}
