using System.Windows;
using System.Windows.Controls;

namespace WinCCAlarmEditor;

/// <summary>Einfaches Eingabefeld als Dialog.</summary>
internal static class InputDialog
{
    public static string? Ask(Window owner, string title, string prompt, string initialValue)
    {
        var box = new TextBox { Text = initialValue, Margin = new Thickness(0, 6, 0, 12), MinWidth = 300, Padding = new Thickness(2) };
        var ok = new Button { Content = "OK", IsDefault = true, Width = 90 };
        var cancel = new Button { Content = "Abbrechen", IsCancel = true, Width = 90 };

        var buttons = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right };
        buttons.Children.Add(ok);
        buttons.Children.Add(cancel);

        var panel = new StackPanel { Margin = new Thickness(14) };
        panel.Children.Add(new TextBlock { Text = prompt });
        panel.Children.Add(box);
        panel.Children.Add(buttons);

        var window = new Window
        {
            Title = title,
            Content = panel,
            Owner = owner,
            SizeToContent = SizeToContent.WidthAndHeight,
            ResizeMode = ResizeMode.NoResize,
            WindowStartupLocation = WindowStartupLocation.CenterOwner,
            ShowInTaskbar = false,
        };
        ok.Click += (_, _) => window.DialogResult = true;
        window.Loaded += (_, _) =>
        {
            box.Focus();
            box.SelectAll();
        };
        return window.ShowDialog() == true ? box.Text.Trim() : null;
    }
}
