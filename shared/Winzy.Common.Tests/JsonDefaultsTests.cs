using System.Text.Json;
using Winzy.Common.Json;

namespace Winzy.Common.Tests;

public class JsonDefaultsTests
{
    [Fact]
    public void CamelCase_UsesLowerCamelCasePropertyNames()
    {
        var obj = new { MyProperty = "value" };

        var json = JsonSerializer.Serialize(obj, JsonDefaults.CamelCase);

        Assert.Contains("\"myProperty\"", json);
        Assert.DoesNotContain("\"MyProperty\"", json);
    }

    [Fact]
    public void CamelCase_SerializesEnumsAsCamelCaseStrings()
    {
        var obj = new { Status = SampleEnum.InProgress };

        var json = JsonSerializer.Serialize(obj, JsonDefaults.CamelCase);

        Assert.Contains("\"inProgress\"", json);
    }

    [Fact]
    public void CamelCase_DeserializesEnumFromCamelCaseString()
    {
        var json = """{"status":"inProgress"}""";

        var result = JsonSerializer.Deserialize<EnumWrapper>(json, JsonDefaults.CamelCase);

        Assert.Equal(SampleEnum.InProgress, result!.Status);
    }

    [Fact]
    public void CamelCase_IsSameInstanceAcrossCalls()
    {
        var a = JsonDefaults.CamelCase;
        var b = JsonDefaults.CamelCase;

        Assert.Same(a, b);
    }

    private enum SampleEnum { None, InProgress, Completed }
    private record EnumWrapper(SampleEnum Status);
}
