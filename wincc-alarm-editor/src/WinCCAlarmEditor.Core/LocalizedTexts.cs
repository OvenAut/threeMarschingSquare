using System.ComponentModel;

namespace WinCCAlarmEditor.Core;

/// <summary>Text pro Sprache (z. B. "de-DE"). Im WPF-Binding als Texts[de-DE] ansprechbar.</summary>
public sealed class LocalizedTexts : INotifyPropertyChanged
{
    private readonly Dictionary<string, string> _texts = new(StringComparer.OrdinalIgnoreCase);

    public event PropertyChangedEventHandler? PropertyChanged;

    public string this[string language]
    {
        get => _texts.TryGetValue(language, out var text) ? text : string.Empty;
        set
        {
            value ??= string.Empty;
            if (this[language] == value) return;
            _texts[language] = value;
            PropertyChanged?.Invoke(this, new PropertyChangedEventArgs("Item[]"));
        }
    }

    public IReadOnlyDictionary<string, string> All => _texts;

    public void CopyFrom(LocalizedTexts other)
    {
        foreach (var (language, text) in other._texts) this[language] = text;
    }
}
