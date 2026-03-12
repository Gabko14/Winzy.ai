using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Winzy.ChallengeService.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddProcessedCompletionDates : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "processed_completion_dates",
                table: "challenges",
                type: "text",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "processed_completion_dates",
                table: "challenges");
        }
    }
}
