using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Winzy.ActivityService.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddActorNameColumns : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "actor_display_name",
                table: "feed_entries",
                type: "character varying(128)",
                maxLength: 128,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "actor_username",
                table: "feed_entries",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "actor_display_name",
                table: "feed_entries");

            migrationBuilder.DropColumn(
                name: "actor_username",
                table: "feed_entries");
        }
    }
}
