using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Winzy.ActivityService.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddIdempotencyKey : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "idempotency_key",
                table: "feed_entries",
                type: "character varying(256)",
                maxLength: 256,
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "ix_feed_entries_idempotency_key",
                table: "feed_entries",
                column: "idempotency_key",
                unique: true,
                filter: "idempotency_key IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "ix_feed_entries_idempotency_key",
                table: "feed_entries");

            migrationBuilder.DropColumn(
                name: "idempotency_key",
                table: "feed_entries");
        }
    }
}
