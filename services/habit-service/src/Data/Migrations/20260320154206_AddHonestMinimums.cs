using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Winzy.HabitService.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddHonestMinimums : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "minimum_description",
                table: "habits",
                type: "character varying(512)",
                maxLength: 512,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "completion_kind",
                table: "completions",
                type: "character varying(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "Full");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "minimum_description",
                table: "habits");

            migrationBuilder.DropColumn(
                name: "completion_kind",
                table: "completions");
        }
    }
}
