using System.Collections.ObjectModel;

namespace WinCCAlarmEditor.Core;

/// <summary>Eine Meldungsliste (entspricht einer Excel-Datei für den Import ins TIA Portal).</summary>
public sealed class AlarmDocument
{
    public ObservableCollection<DiscreteAlarm> DiscreteAlarms { get; } = new();
    public ObservableCollection<AnalogAlarm> AnalogAlarms { get; } = new();

    /// <summary>Projektsprachen; die erste ist die Hauptsprache für Prüfung und Seriengenerator.</summary>
    public ObservableCollection<string> Languages { get; } = new();

    /// <summary>Zuletzt geöffnete/gespeicherte Datei. Dient beim Speichern als Vorlage (andere Blätter, Formatierung).</summary>
    public string? FilePath { get; set; }

    public SheetLayout? DiscreteLayout { get; set; }
    public SheetLayout? AnalogLayout { get; set; }

    public string PrimaryLanguage => Languages.FirstOrDefault() ?? "de-DE";

    public static AlarmDocument CreateNew(string language = "de-DE")
    {
        var doc = new AlarmDocument();
        doc.Languages.Add(language);
        return doc;
    }

    public int NextDiscreteId() => DiscreteAlarms.Count == 0 ? 1 : DiscreteAlarms.Max(a => a.Id) + 1;
    public int NextAnalogId() => AnalogAlarms.Count == 0 ? 1 : AnalogAlarms.Max(a => a.Id) + 1;

    public DiscreteAlarm NewDiscrete()
    {
        var alarm = new DiscreteAlarm { Id = NextDiscreteId() };
        alarm.Name = $"Alarm_{alarm.Id}";
        ApplyDefaults(alarm, DiscreteLayout);
        return alarm;
    }

    public AnalogAlarm NewAnalog()
    {
        var alarm = new AnalogAlarm { Id = NextAnalogId() };
        alarm.Name = $"AnalogAlarm_{alarm.Id}";
        ApplyDefaults(alarm, AnalogLayout);
        return alarm;
    }

    public static void ApplyDefaults(AlarmBase alarm, SheetLayout? layout)
    {
        if (layout is null) return;
        foreach (var (header, value) in layout.Defaults)
            alarm.Extra.TryAdd(header, value);
    }
}
