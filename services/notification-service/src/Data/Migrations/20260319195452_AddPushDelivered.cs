using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Winzy.NotificationService.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddPushDelivered : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "push_delivered",
                table: "notifications",
                type: "boolean",
                nullable: false,
                defaultValue: false);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "push_delivered",
                table: "notifications");
        }
    }
}
