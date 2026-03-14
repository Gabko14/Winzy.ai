using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Winzy.ActivityService.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddDeletedAtPartialIndex : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateIndex(
                name: "ix_feed_entries_not_deleted",
                table: "feed_entries",
                column: "deleted_at",
                filter: "deleted_at IS NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "ix_feed_entries_not_deleted",
                table: "feed_entries");
        }
    }
}
