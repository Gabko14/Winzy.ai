using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Winzy.HabitService.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddPromiseIsPublicOnFlame : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "is_public_on_flame",
                table: "promises",
                type: "boolean",
                nullable: false,
                defaultValue: false);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "is_public_on_flame",
                table: "promises");
        }
    }
}
