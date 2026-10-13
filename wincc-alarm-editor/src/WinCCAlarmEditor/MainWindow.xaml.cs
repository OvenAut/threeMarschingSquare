using System.Collections;
using System.Collections.ObjectModel;
using System.Collections.Specialized;
using System.ComponentModel;
using System.Text.RegularExpressions;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Data;
using System.Windows.Input;
using Microsoft.Win32;
using WinCCAlarmEditor.Core;

namespace WinCCAlarmEditor;

public partial class MainWindow : Window
{
    private const string AppTitle = "WinCC Unified Meldungseditor";
    private const string FileFilter = "Excel-Arbeitsmappe (*.xlsx)|*.xlsx";
    private static readonly Regex LanguagePattern = new(@"^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$");

    // Vorschläge für die Auswahlfelder; Werte aus geöffneten Dateien kommen automatisch dazu.
    private readonly ObservableCollection<string> _alarmClasses = new() { "Alarm", "Warning", "Information" };
    private readonly ObservableCollection<string> _triggerModes = new() { "On rising edge", "On falling edge" };
    private readonly ObservableCollection<string> _limitModes = new() { "Higher", "Lower", "Equal", "Unequal", "Higher or equal", "Lower or equal" };

    private AlarmDocument _doc = AlarmDocument.CreateNew();
    private bool _dirty;

    public MainWindow()
    {
        InitializeComponent();
        DiscreteGrid.PreviewKeyDown += Grid_PreviewKeyDown;
        AnalogGrid.PreviewKeyDown += Grid_PreviewKeyDown;
        PreviewKeyDown += Window_PreviewKeyDown;
        SetDocument(AlarmDocument.CreateNew());
    }

    private bool IsAnalogTab => Tabs.SelectedItem == AnalogTab;
    private DataGrid ActiveGrid => IsAnalogTab ? AnalogGrid : DiscreteGrid;
    private IList ActiveList => IsAnalogTab ? _doc.AnalogAlarms : _doc.DiscreteAlarms;

    // ───────────────────────────── Dokument ─────────────────────────────

    private void SetDocument(AlarmDocument doc)
    {
        Detach(_doc);
        _doc = doc;
        Attach(doc);
        CollectSuggestions();
        RebuildColumns();
        DiscreteGrid.ItemsSource = doc.DiscreteAlarms;
        AnalogGrid.ItemsSource = doc.AnalogAlarms;
        IssuesList.ItemsSource = null;
        IssuesExpander.Header = "Prüfergebnisse";
        _dirty = false;
        UpdateTitle();
    }

    private void Attach(AlarmDocument doc)
    {
        doc.DiscreteAlarms.CollectionChanged += Alarms_CollectionChanged;
        doc.AnalogAlarms.CollectionChanged += Alarms_CollectionChanged;
        foreach (var alarm in AllAlarms(doc)) alarm.PropertyChanged += Alarm_PropertyChanged;
    }

    private void Detach(AlarmDocument doc)
    {
        doc.DiscreteAlarms.CollectionChanged -= Alarms_CollectionChanged;
        doc.AnalogAlarms.CollectionChanged -= Alarms_CollectionChanged;
        foreach (var alarm in AllAlarms(doc)) alarm.PropertyChanged -= Alarm_PropertyChanged;
    }

    private static IEnumerable<AlarmBase> AllAlarms(AlarmDocument doc) =>
        doc.DiscreteAlarms.Cast<AlarmBase>().Concat(doc.AnalogAlarms);

    private void Alarms_CollectionChanged(object? sender, NotifyCollectionChangedEventArgs e)
    {
        if (e.OldItems is not null)
            foreach (AlarmBase alarm in e.OldItems) alarm.PropertyChanged -= Alarm_PropertyChanged;
        if (e.NewItems is not null)
            foreach (AlarmBase alarm in e.NewItems) alarm.PropertyChanged += Alarm_PropertyChanged;
        MarkDirty();
    }

    private void Alarm_PropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName is nameof(AlarmBase.Issue) or nameof(AlarmBase.HasIssue)) return;
        MarkDirty();
    }

    /// <summary>Übernimmt Meldeklassen und Modi aus der Liste in die Auswahlvorschläge.</summary>
    private void CollectSuggestions()
    {
        foreach (var alarm in _doc.DiscreteAlarms)
        {
            AddSuggestion(_alarmClasses, alarm.AlarmClass);
            AddSuggestion(_triggerModes, alarm.TriggerMode);
        }
        foreach (var alarm in _doc.AnalogAlarms)
        {
            AddSuggestion(_alarmClasses, alarm.AlarmClass);
            AddSuggestion(_limitModes, alarm.LimitMode);
        }
    }

    private static void AddSuggestion(ObservableCollection<string> list, string value)
    {
        if (!string.IsNullOrWhiteSpace(value) && !list.Contains(value, StringComparer.OrdinalIgnoreCase))
            list.Add(value);
    }

    private void MarkDirty()
    {
        _dirty = true;
        UpdateTitle();
    }

    private void UpdateTitle()
    {
        var name = _doc.FilePath is null ? "Unbenannt" : Path.GetFileName(_doc.FilePath);
        Title = $"{(_dirty ? "*" : "")}{name} – {AppTitle}";
        DiscreteTab.Header = $"Bitmeldungen ({_doc.DiscreteAlarms.Count})";
        AnalogTab.Header = $"Analogmeldungen ({_doc.AnalogAlarms.Count})";
        LanguagesText.Text = string.Join(", ", _doc.Languages);
        StatusText.Text = _doc.FilePath
            ?? "Tipp: Zuerst im TIA Portal die HMI-Meldungen exportieren und hier öffnen – dann passt das Spaltenformat garantiert zum Import.";
    }

    // ───────────────────────────── Spalten ─────────────────────────────

    private void RebuildColumns()
    {
        DiscreteGrid.Columns.Clear();
        AddLeadingColumns(DiscreteGrid);
        DiscreteGrid.Columns.Add(ComboColumn("Meldeklasse", nameof(AlarmBase.AlarmClass), _alarmClasses, 110));
        DiscreteGrid.Columns.Add(TextColumn("Trigger-Variable", nameof(AlarmBase.TriggerTag), 180));
        DiscreteGrid.Columns.Add(TextColumn("Trigger-Bit", nameof(DiscreteAlarm.TriggerBit), 75));
        DiscreteGrid.Columns.Add(ComboColumn("Triggermodus", nameof(DiscreteAlarm.TriggerMode), _triggerModes, 120));
        DiscreteGrid.Columns.Add(TextColumn("Quittier-Variable", nameof(DiscreteAlarm.AckTag), 150));
        DiscreteGrid.Columns.Add(TextColumn("Quittier-Bit", nameof(DiscreteAlarm.AckBit), 75));
        AddTrailingColumns(DiscreteGrid);

        AnalogGrid.Columns.Clear();
        AddLeadingColumns(AnalogGrid);
        AnalogGrid.Columns.Add(ComboColumn("Meldeklasse", nameof(AlarmBase.AlarmClass), _alarmClasses, 110));
        AnalogGrid.Columns.Add(TextColumn("Trigger-Variable", nameof(AlarmBase.TriggerTag), 180));
        AnalogGrid.Columns.Add(TextColumn("Grenzwert", nameof(AnalogAlarm.Limit), 100));
        AnalogGrid.Columns.Add(ComboColumn("Grenzwertmodus", nameof(AnalogAlarm.LimitMode), _limitModes, 130));
        AddTrailingColumns(AnalogGrid);
    }

    private void AddLeadingColumns(DataGrid grid)
    {
        grid.Columns.Add(TextColumn("ID", nameof(AlarmBase.Id), 60));
        grid.Columns.Add(TextColumn("Name", nameof(AlarmBase.Name), 160));
        foreach (var language in _doc.Languages)
            grid.Columns.Add(TextColumn($"Meldetext ({language})", $"Texts[{language}]", 260));
    }

    private void AddTrailingColumns(DataGrid grid)
    {
        grid.Columns.Add(TextColumn("Priorität", nameof(AlarmBase.Priority), 70));
        foreach (var language in _doc.Languages)
            grid.Columns.Add(TextColumn($"Infotext ({language})", $"InfoTexts[{language}]", 200));
        grid.Columns.Add(TextColumn("Herkunft", nameof(AlarmBase.Origin), 110));
        grid.Columns.Add(TextColumn("Bereich", nameof(AlarmBase.Area), 110));
        var issue = TextColumn("Prüfhinweis", nameof(AlarmBase.Issue), 300);
        issue.IsReadOnly = true;
        issue.Foreground = System.Windows.Media.Brushes.Firebrick;
        grid.Columns.Add(issue);
    }

    private static DataGridTextColumn TextColumn(string header, string path, double width) => new()
    {
        Header = header,
        Width = width,
        Binding = new Binding(path) { ValidatesOnExceptions = true },
    };

    private static DataGridTemplateColumn ComboColumn(string header, string path, IEnumerable<string> items, double width)
    {
        var display = new FrameworkElementFactory(typeof(TextBlock));
        display.SetBinding(TextBlock.TextProperty, new Binding(path));
        display.SetValue(TextBlock.MarginProperty, new Thickness(2, 0, 2, 0));

        var editor = new FrameworkElementFactory(typeof(ComboBox));
        editor.SetValue(ComboBox.IsEditableProperty, true);
        editor.SetValue(ItemsControl.ItemsSourceProperty, items);
        editor.SetBinding(ComboBox.TextProperty, new Binding(path) { UpdateSourceTrigger = UpdateSourceTrigger.PropertyChanged });

        return new DataGridTemplateColumn
        {
            Header = header,
            Width = width,
            SortMemberPath = path,
            ClipboardContentBinding = new Binding(path),
            CellTemplate = new DataTemplate { VisualTree = display },
            CellEditingTemplate = new DataTemplate { VisualTree = editor },
        };
    }

    // ───────────────────────────── Datei ─────────────────────────────

    private void Window_Loaded(object sender, RoutedEventArgs e)
    {
        var args = Environment.GetCommandLineArgs();
        if (args.Length > 1 && File.Exists(args[1])) OpenFile(args[1]);
    }

    private void New_Executed(object sender, ExecutedRoutedEventArgs e)
    {
        if (ConfirmDiscard()) SetDocument(AlarmDocument.CreateNew());
    }

    private void Open_Executed(object sender, ExecutedRoutedEventArgs e)
    {
        if (!ConfirmDiscard()) return;
        var dialog = new OpenFileDialog { Filter = FileFilter, Title = "Meldungs-Exportdatei öffnen" };
        if (dialog.ShowDialog(this) == true) OpenFile(dialog.FileName);
    }

    private void Save_Executed(object sender, ExecutedRoutedEventArgs e) => Save(_doc.FilePath);

    private void SaveAs_Executed(object sender, ExecutedRoutedEventArgs e) => Save(null);

    private void OpenFile(string path)
    {
        try
        {
            SetDocument(ExcelService.Load(path));
            RunValidation();
            StatusText.Text = $"{path} – {_doc.DiscreteAlarms.Count} Bitmeldungen, {_doc.AnalogAlarms.Count} Analogmeldungen geladen.";
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, $"Die Datei konnte nicht geöffnet werden.\n\n{ex.Message}", AppTitle,
                MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private bool Save(string? path)
    {
        CommitEdits();
        var issues = RunValidation();
        var errors = issues.Count(i => i.Severity == Severity.Error);
        if (errors > 0 && MessageBox.Show(this,
                $"Die Prüfung hat {errors} Fehler gefunden. Der Import ins TIA Portal wird dafür wahrscheinlich Meldungen ablehnen.\n\nTrotzdem speichern?",
                AppTitle, MessageBoxButton.YesNo, MessageBoxImage.Warning) != MessageBoxResult.Yes)
            return false;

        if (path is null)
        {
            var dialog = new SaveFileDialog
            {
                Filter = FileFilter,
                DefaultExt = ".xlsx",
                AddExtension = true,
                FileName = _doc.FilePath is null ? "HMIAlarms.xlsx" : Path.GetFileName(_doc.FilePath),
            };
            if (dialog.ShowDialog(this) != true) return false;
            path = dialog.FileName;
        }

        try
        {
            ExcelService.Save(_doc, path);
        }
        catch (IOException ex)
        {
            MessageBox.Show(this, $"Die Datei konnte nicht gespeichert werden – ist sie noch in Excel geöffnet?\n\n{ex.Message}",
                AppTitle, MessageBoxButton.OK, MessageBoxImage.Error);
            return false;
        }

        _dirty = false;
        UpdateTitle();
        StatusText.Text = $"Gespeichert: {path} – im TIA Portal unter HMI-Meldungen → Importieren einlesen.";
        return true;
    }

    private bool ConfirmDiscard()
    {
        if (!_dirty) return true;
        var answer = MessageBox.Show(this, "Die Änderungen wurden noch nicht gespeichert. Jetzt speichern?", AppTitle,
            MessageBoxButton.YesNoCancel, MessageBoxImage.Question);
        return answer switch
        {
            MessageBoxResult.Yes => Save(_doc.FilePath),
            MessageBoxResult.No => true,
            _ => false,
        };
    }

    private void Window_Drop(object sender, DragEventArgs e)
    {
        if (e.Data.GetData(DataFormats.FileDrop) is not string[] files) return;
        var file = files.FirstOrDefault(f => f.EndsWith(".xlsx", StringComparison.OrdinalIgnoreCase));
        if (file is not null && ConfirmDiscard()) OpenFile(file);
    }

    private void Window_Closing(object? sender, CancelEventArgs e)
    {
        CommitEdits();
        if (!ConfirmDiscard()) e.Cancel = true;
    }

    // ───────────────────────────── Bearbeiten ─────────────────────────────

    private void CommitEdits()
    {
        DiscreteGrid.CommitEdit(DataGridEditingUnit.Row, true);
        AnalogGrid.CommitEdit(DataGridEditingUnit.Row, true);
    }

    private List<AlarmBase> SelectedAlarms()
    {
        var list = ActiveList;
        return ActiveGrid.SelectedItems.OfType<AlarmBase>().OrderBy(a => list.IndexOf(a)).ToList();
    }

    private void Add_Click(object sender, RoutedEventArgs e) => AddAlarm();

    private void AddAlarm()
    {
        CommitEdits();
        var selected = SelectedAlarms().LastOrDefault();
        AlarmBase alarm;
        if (IsAnalogTab)
        {
            alarm = _doc.NewAnalog();
            if (selected is AnalogAlarm previous)
            {
                alarm.AlarmClass = previous.AlarmClass;
                ((AnalogAlarm)alarm).LimitMode = previous.LimitMode;
            }
        }
        else
        {
            var discrete = _doc.NewDiscrete();
            // Nächstes Bit derselben Variable vorschlagen
            var previous = selected as DiscreteAlarm ?? _doc.DiscreteAlarms.LastOrDefault();
            if (previous is not null)
            {
                discrete.TriggerTag = previous.TriggerTag;
                discrete.TriggerBit = previous.TriggerBit + 1;
                discrete.TriggerMode = previous.TriggerMode;
                discrete.AlarmClass = previous.AlarmClass;
            }
            alarm = discrete;
        }
        InsertAndSelect(new[] { alarm }, selected);
    }

    private void InsertAndSelect(IReadOnlyList<AlarmBase> alarms, AlarmBase? after)
    {
        var list = ActiveList;
        var index = after is null ? list.Count : list.IndexOf(after) + 1;
        foreach (var alarm in alarms) list.Insert(index++, alarm);

        var grid = ActiveGrid;
        grid.SelectedItems.Clear();
        foreach (var alarm in alarms) grid.SelectedItems.Add(alarm);
        grid.ScrollIntoView(alarms[^1]);
        grid.CurrentCell = new DataGridCellInfo(alarms[0], grid.Columns[1]);
        grid.Focus();
    }

    private void Duplicate_Click(object sender, RoutedEventArgs e) => DuplicateSelection();

    private void DuplicateSelection()
    {
        CommitEdits();
        var selected = SelectedAlarms();
        if (selected.Count == 0) return;

        var list = ActiveList.Cast<AlarmBase>().ToList();
        var names = new HashSet<string>(list.Select(a => a.Name), StringComparer.OrdinalIgnoreCase);
        var nextId = list.Count == 0 ? 1 : list.Max(a => a.Id) + 1;
        var copies = new List<AlarmBase>();
        foreach (var source in selected)
        {
            var copy = source.CloneAlarm();
            copy.Id = nextId++;
            copy.Name = UniqueName($"{source.Name}_Kopie", names);
            copies.Add(copy);
        }
        InsertAndSelect(copies, selected[^1]);
    }

    private static string UniqueName(string baseName, HashSet<string> taken)
    {
        var name = baseName;
        for (var i = 2; taken.Contains(name); i++) name = $"{baseName}{i}";
        taken.Add(name);
        return name;
    }

    private void Delete_Click(object sender, RoutedEventArgs e)
    {
        CommitEdits();
        var selected = SelectedAlarms();
        if (selected.Count == 0) return;
        if (selected.Count > 1 && MessageBox.Show(this, $"{selected.Count} Meldungen löschen?", AppTitle,
                MessageBoxButton.YesNo, MessageBoxImage.Question) != MessageBoxResult.Yes)
            return;
        var list = ActiveList;
        foreach (var alarm in selected) list.Remove(alarm);
    }

    private void Renumber_Click(object sender, RoutedEventArgs e)
    {
        CommitEdits();
        var grid = ActiveGrid;
        var items = grid.Items.OfType<AlarmBase>().ToList(); // angezeigte (ggf. sortierte) Reihenfolge
        if (items.Count == 0) return;
        if (MessageBox.Show(this, $"IDs der {items.Count} {(IsAnalogTab ? "Analog" : "Bit")}meldungen in der angezeigten Reihenfolge neu ab 1 vergeben?",
                AppTitle, MessageBoxButton.YesNo, MessageBoxImage.Question) != MessageBoxResult.Yes)
            return;
        for (var i = 0; i < items.Count; i++) items[i].Id = i + 1;
    }

    private void Series_Click(object sender, RoutedEventArgs e)
    {
        CommitEdits();
        var dialog = new SeriesWindow(_doc.NextDiscreteId(), _doc.PrimaryLanguage, _alarmClasses) { Owner = this };
        if (dialog.ShowDialog() != true || dialog.Result.Count == 0) return;

        foreach (var alarm in dialog.Result) AlarmDocument.ApplyDefaults(alarm, _doc.DiscreteLayout);
        Tabs.SelectedItem = DiscreteTab;
        InsertAndSelect(dialog.Result, _doc.DiscreteAlarms.LastOrDefault());
        StatusText.Text = $"{dialog.Result.Count} Bitmeldungen erzeugt.";
    }

    private void AddLanguage_Click(object sender, RoutedEventArgs e)
    {
        var language = InputDialog.Ask(this, "Sprache hinzufügen", "Sprachkennung wie im TIA-Projekt (z. B. en-US, fr-FR):", "en-US");
        if (language is null) return;
        if (!LanguagePattern.IsMatch(language))
        {
            MessageBox.Show(this, $"\"{language}\" ist keine gültige Sprachkennung.", AppTitle, MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }
        if (_doc.Languages.Contains(language, StringComparer.OrdinalIgnoreCase)) return;

        CommitEdits();
        _doc.Languages.Add(language);
        RebuildColumns();
        MarkDirty();
    }

    // ───────────────────────────── Prüfen ─────────────────────────────

    private void Validate_Click(object sender, RoutedEventArgs e) => RunValidation();

    private List<ValidationIssue> RunValidation()
    {
        CommitEdits();
        CollectSuggestions();
        var issues = AlarmValidator.Validate(_doc);
        IssuesList.ItemsSource = issues;
        var errors = issues.Count(i => i.Severity == Severity.Error);
        var warnings = issues.Count - errors;
        IssuesExpander.Header = issues.Count == 0
            ? "Prüfergebnisse – keine Probleme gefunden"
            : $"Prüfergebnisse – {errors} Fehler, {warnings} Warnungen";
        IssuesExpander.IsExpanded = issues.Count > 0;
        return issues;
    }

    private void Issues_DoubleClick(object sender, MouseButtonEventArgs e)
    {
        if (IssuesList.SelectedItem is not ValidationIssue issue) return;
        var analog = issue.Alarm is AnalogAlarm;
        Tabs.SelectedItem = analog ? AnalogTab : DiscreteTab;
        var grid = analog ? AnalogGrid : DiscreteGrid;
        grid.SelectedItem = issue.Alarm;
        grid.ScrollIntoView(issue.Alarm);
        grid.Focus();
    }

    // ───────────────────────────── Tastatur / Einfügen ─────────────────────────────

    private void Window_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.F5) { RunValidation(); e.Handled = true; }
        else if (Keyboard.Modifiers == ModifierKeys.Control && e.Key == Key.D) { DuplicateSelection(); e.Handled = true; }
        else if (Keyboard.Modifiers == ModifierKeys.Control && e.Key == Key.Insert) { AddAlarm(); e.Handled = true; }
    }

    /// <summary>Strg+V außerhalb des Bearbeitungsmodus fügt Tabellen aus Excel ab der aktuellen Zelle ein.</summary>
    private void Grid_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key != Key.V || Keyboard.Modifiers != ModifierKeys.Control) return;
        if (e.OriginalSource is TextBox or ComboBox) return; // Zelle wird gerade bearbeitet
        if (!Clipboard.ContainsText()) return;
        PasteTable((DataGrid)sender, Clipboard.GetText());
        e.Handled = true;
    }

    private void PasteTable(DataGrid grid, string text)
    {
        grid.CommitEdit(DataGridEditingUnit.Row, true);
        var rows = text.Replace("\r\n", "\n").Replace('\r', '\n').TrimEnd('\n')
            .Split('\n').Select(line => line.Split('\t')).ToList();
        if (rows.Count == 0) return;

        var columns = grid.Columns.Where(c => c.Visibility == Visibility.Visible).OrderBy(c => c.DisplayIndex).ToList();
        var startColumn = grid.CurrentCell.Column is { } current ? Math.Max(0, columns.IndexOf(current)) : 0;
        var analog = grid == AnalogGrid;
        IList list = analog ? _doc.AnalogAlarms : _doc.DiscreteAlarms;
        var startRow = grid.CurrentCell.Item is AlarmBase currentAlarm ? list.IndexOf(currentAlarm) : -1;
        if (startRow < 0) startRow = list.Count;

        for (var r = 0; r < rows.Count; r++)
        {
            var index = startRow + r;
            AlarmBase target;
            if (index < list.Count)
            {
                target = (AlarmBase)list[index]!;
            }
            else
            {
                target = analog ? _doc.NewAnalog() : _doc.NewDiscrete();
                list.Add(target);
            }

            for (var c = 0; c < rows[r].Length && startColumn + c < columns.Count; c++)
            {
                var column = columns[startColumn + c];
                if (column.IsReadOnly) continue;
                var path = column switch
                {
                    DataGridBoundColumn bound => (bound.Binding as Binding)?.Path?.Path,
                    DataGridTemplateColumn template => template.SortMemberPath,
                    _ => null,
                };
                if (path is not null) target.SetByPath(path, rows[r][c].Trim());
            }
        }
        StatusText.Text = $"{rows.Count} Zeile(n) aus der Zwischenablage eingefügt.";
    }
}
