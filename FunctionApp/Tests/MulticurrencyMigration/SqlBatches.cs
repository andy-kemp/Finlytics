using System.Text;
using System.Text.RegularExpressions;

internal static class SqlBatches
{
    internal static IReadOnlyList<string> Split(string script)
    {
        var batches = new List<string>();
        var current = new StringBuilder();
        var quote = '\0';
        var commentDepth = 0;
        using var reader = new StringReader(script);
        while (reader.ReadLine() is { } line)
        {
            if (quote == '\0' && commentDepth == 0)
            {
                var separator = Regex.Match(line, @"^\s*GO(?:\s+(\d+))?\s*(?:--.*)?$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
                if (separator.Success)
                {
                    var count = separator.Groups[1].Success ? int.Parse(separator.Groups[1].Value) : 1;
                    if (count is < 1 or > 100) throw new InvalidOperationException("GO repeat count must be between 1 and 100.");
                    if (!string.IsNullOrWhiteSpace(current.ToString()))
                        for (var repeat = 0; repeat < count; repeat++) batches.Add(current.ToString());
                    current.Clear();
                    continue;
                }
            }
            current.AppendLine(line);
            for (var index = 0; index < line.Length; index++)
            {
                var character = line[index];
                var next = index + 1 < line.Length ? line[index + 1] : '\0';
                if (commentDepth > 0)
                {
                    if (character == '/' && next == '*') { commentDepth++; index++; }
                    else if (character == '*' && next == '/') { commentDepth--; index++; }
                }
                else if (quote != '\0')
                {
                    if (character == quote && next == quote) index++;
                    else if (character == quote) quote = '\0';
                }
                else if (character == '-' && next == '-') break;
                else if (character == '/' && next == '*') { commentDepth++; index++; }
                else if (character is '\'' or '"' or '[') quote = character == '[' ? ']' : character;
            }
        }
        if (quote != '\0' || commentDepth != 0) throw new InvalidOperationException("Unterminated SQL literal, identifier, or comment.");
        if (!string.IsNullOrWhiteSpace(current.ToString())) batches.Add(current.ToString());
        return batches;
    }
}