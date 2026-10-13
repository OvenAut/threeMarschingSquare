using WinCCAlarmEditor.Core;

namespace WinCCAlarmEditor.Tests;

public sealed class CoreTests
{
    [Theory]
    [InlineData("Alarm text [de-DE], Alarm text", ColumnKind.Text, "de-DE")]
    [InlineData("Event text [en-US], Alarm text", ColumnKind.Text, "en-US")]
    [InlineData("Info text [fr-FR], Info text", ColumnKind.InfoText, "fr-FR")]
    [InlineData("Trigger tag", ColumnKind.Field, null)]
    [InlineData("Acknowledgement tag", ColumnKind.Field, null)]
    [InlineData("Additional text 1 [de-DE], Alarm parameter 1", ColumnKind.Extra, null)]
    public void ClassifiesHeaders(string header, ColumnKind kind, string? language)
    {
        var info = AlarmSchema.Classify(header, AlarmSchema.Discrete);
        Assert.Equal(kind, info.Kind);
        Assert.Equal(language, info.Language);
    }

    [Fact]
    public void SeriesRollsOverToNextTag()
    {
        var alarms = SeriesGenerator.Generate(new SeriesOptions
        {
            Count = 20,
            StartId = 100,
            NamePattern = "Stoerung_{n:000}",
            TagPattern = "\"DB_HMI\".Alarme[{w}]",
            StartWord = 0,
            BitsPerTag = 16,
            TextPattern = "Störung {n} (Wort {w}, Bit {bit})",
            Texts = new[] { "Not-Halt betätigt", "" },
        });

        Assert.Equal(20, alarms.Count);
        Assert.Equal("Not-Halt betätigt", alarms[0].Texts["de-DE"]);
        Assert.Equal("Störung 2 (Wort 0, Bit 1)", alarms[1].Texts["de-DE"]);
        Assert.Equal(119, alarms[19].Id);
        Assert.Equal("Stoerung_020", alarms[19].Name);
        Assert.Equal("\"DB_HMI\".Alarme[1]", alarms[19].TriggerTag);
        Assert.Equal(3, alarms[19].TriggerBit);
    }

    [Fact]
    public void ValidatorFindsDuplicatesAndMissingFields()
    {
        var doc = AlarmDocument.CreateNew();
        var a = new DiscreteAlarm { Id = 1, Name = "A", TriggerTag = "T", TriggerBit = 0 };
        a.Texts["de-DE"] = "Text";
        var b = new DiscreteAlarm { Id = 1, Name = "a", TriggerTag = "", TriggerBit = 0 };
        doc.DiscreteAlarms.Add(a);
        doc.DiscreteAlarms.Add(b);
        var analog = new AnalogAlarm { Id = 1, Name = "X", TriggerTag = "Druck" };
        doc.AnalogAlarms.Add(analog);

        var issues = AlarmValidator.Validate(doc);

        Assert.Contains(issues, i => i.Alarm == b && i.Message.Contains("Trigger-Variable"));
        Assert.Contains(issues, i => i.Alarm == a && i.Message.Contains("ID 1"));
        Assert.Contains(issues, i => i.Alarm == b && i.Message.Contains("Name"));
        Assert.Contains(issues, i => i.Alarm == analog && i.Message.Contains("Grenzwert"));
        Assert.True(b.HasIssue);
    }

    [Fact]
    public void SetByPathHandlesTextColumns()
    {
        var alarm = new DiscreteAlarm();
        alarm.SetByPath("Texts[en-US]", "Pump fault");
        alarm.SetByPath("InfoTexts[de-DE]", "Info");
        alarm.SetByPath("TriggerBit", "7");
        alarm.SetByPath("Id", "42");
        Assert.Equal("Pump fault", alarm.Texts["en-US"]);
        Assert.Equal("Info", alarm.InfoTexts["de-DE"]);
        Assert.Equal(7, alarm.TriggerBit);
        Assert.Equal(42, alarm.Id);
    }
}
