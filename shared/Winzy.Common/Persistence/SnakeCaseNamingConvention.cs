using System.Text;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;

namespace Winzy.Common.Persistence;

/// <summary>
/// Applies PostgreSQL snake_case naming to all tables, columns, keys, indexes, and foreign keys.
/// Call <see cref="ModelBuilderExtensions.ApplySnakeCaseNaming"/> in OnModelCreating.
/// </summary>
public static class ModelBuilderExtensions
{
    public static void ApplySnakeCaseNaming(this ModelBuilder modelBuilder)
    {
        foreach (var entity in modelBuilder.Model.GetEntityTypes())
        {
            // Table name
            var tableName = entity.GetTableName();
            if (tableName is not null)
                entity.SetTableName(ToSnakeCase(tableName));

            // Column names
            foreach (var property in entity.GetProperties())
            {
                var storeObjectId = StoreObjectIdentifier.Table(
                    entity.GetTableName()!, entity.GetSchema());
                var columnName = property.GetColumnName(storeObjectId);
                if (columnName is not null)
                    property.SetColumnName(ToSnakeCase(columnName));
            }

            // Primary and alternate keys
            foreach (var key in entity.GetKeys())
            {
                var keyName = key.GetName();
                if (keyName is not null)
                    key.SetName(ToSnakeCase(keyName));
            }

            // Foreign keys
            foreach (var fk in entity.GetForeignKeys())
            {
                var fkName = fk.GetConstraintName();
                if (fkName is not null)
                    fk.SetConstraintName(ToSnakeCase(fkName));
            }

            // Indexes
            foreach (var index in entity.GetIndexes())
            {
                var indexName = index.GetDatabaseName();
                if (indexName is not null)
                    index.SetDatabaseName(ToSnakeCase(indexName));
            }
        }
    }

    private static string ToSnakeCase(string name)
    {
        if (string.IsNullOrEmpty(name))
            return name;

        var sb = new StringBuilder();
        sb.Append(char.ToLowerInvariant(name[0]));

        for (var i = 1; i < name.Length; i++)
        {
            var c = name[i];
            if (char.IsUpper(c))
            {
                // Don't insert underscore between consecutive uppercase letters (e.g., "PK" stays "pk")
                // unless the next char is lowercase (e.g., "FKUsers" -> "fk_users")
                var prevIsUpper = char.IsUpper(name[i - 1]);
                var nextIsLower = i + 1 < name.Length && char.IsLower(name[i + 1]);

                if (!prevIsUpper || nextIsLower)
                    sb.Append('_');

                sb.Append(char.ToLowerInvariant(c));
            }
            else
            {
                sb.Append(c);
            }
        }

        return sb.ToString();
    }
}
