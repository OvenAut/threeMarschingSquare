using System.Globalization;
using System.Windows;
using System.Windows.Controls;
using WinCCAlarmEditor.Core;

namespace WinCCAlarmEditor;

public partial class SeriesWindow : Window
{
    private readonly string _language;
    private readonly bool _ready;

    public SeriesWindow(int startId, string language, IEnumerable<string> alarmClasses)
    {
        InitializeComponent();
        _language = language;
        StartIdBox.Text = startId.ToString(CultureInfo.InvariantCulture);
        ClassCombo.ItemsSource = alarmClasses;
        ClassCombo.Text = "Alarm";
        _ready = true;
        UpdatePreview();
    }

    public List<DiscreteAlarm> Result { get; private set; } = new();

    private void Input_TextChanged(object sender, TextChangedEventArgs e) => UpdatePreview();

    private void Input_SelectionChanged(object sender, SelectionChangedEventArgs e) => UpdatePreview();

    private void TextsBox_TextChanged(object sender, TextChangedEventArgs e)
    {
        if (!_ready) return;
        var lines = TextLines();
        if (lines.Count > 0) CountBox.Text = lines.Count.ToString(CultureInfo.InvariantCulture);
        UpdatePreview();
    }

    private List<string> TextLines()
    {
        var lines = TextsBox.Text.Replace("\r\n", "\n").Split('\n').ToList();
        while (lines.Count > 0 && string.IsNullOrWhiteSpace(lines[^1])) lines.RemoveAt(lines.Count - 1);
        return lines;
    }

    private bool TryBuildOptions(out SeriesOptions options, out string error)
    {
        options = new SeriesOptions();
        error = string.Empty;
        if (!int.TryParse(CountBox.Text, out var count) || count < 1 || count > 10000) { error = "Anzahl muss zwischen 1 und 10000 liegen."; return false; }
        if (!int.TryParse(StartIdBox.Text, out var startId) || startId < 1) { error = "Erste ID muss eine positive Zahl sein."; return false; }
        if (!int.TryParse(StartWordBox.Text, out var startWord)) { error = "Erster Wert für {w} muss eine Zahl sein."; return false; }
        if (!int.TryParse(StartBitBox.Text, out var startBit) || startBit < 0) { error = "Erstes Bit muss 0 oder größer sein."; return false; }
        if (string.IsNullOrWhiteSpace(NameBox.Text)) { error = "Name-Muster fehlt."; return false; }
        if (string.IsNullOrWhiteSpace(TagBox.Text)) { error = "Trigger-Variable fehlt."; return false; }
        var bits = int.Parse((string)((ComboBoxItem)BitsCombo.SelectedItem).Content, CultureInfo.InvariantCulture);

        options = new SeriesOptions
        {
            Count = count,
            StartId = startId,
            NamePattern = NameBox.Text.Trim(),
            TagPattern = TagBox.Text.Trim(),
            StartWord = startWord,
            BitsPerTag = bits,
            StartBit = startBit,
            TextPattern = TextPatternBox.Text,
            Texts = TextLines(),
            AlarmClass = ClassCombo.Text.Trim(),
            Language = _language,
        };
        return true;
    }

    private void UpdatePreview()
    {
        if (!_ready) return;
        if (!TryBuildOptions(out var options, out var error))
        {
            PreviewText.Text = error;
            OkButton.IsEnabled = false;
            return;
        }

        var alarms = SeriesGenerator.Generate(options);
        string Describe(DiscreteAlarm a) => $"ID {a.Id}  {a.Name}  →  {a.TriggerTag}, Bit {a.TriggerBit}  „{a.Texts[_language]}“";
        PreviewText.Text = alarms.Count == 1
            ? Describe(alarms[0])
            : $"{alarms.Count} Meldungen:\n{Describe(alarms[0])}\n…\n{Describe(alarms[^1])}";
        OkButton.IsEnabled = true;
    }

    private void Ok_Click(object sender, RoutedEventArgs e)
    {
        if (!TryBuildOptions(out var options, out var error))
        {
            MessageBox.Show(this, error, Title, MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }
        Result = SeriesGenerator.Generate(options);
        DialogResult = true;
    }
}
