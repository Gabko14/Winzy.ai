using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Winzy.ChallengeService.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddUniqueActiveIndex : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateIndex(
                name: "ix_challenges_unique_active",
                table: "challenges",
                columns: new[] { "creator_id", "recipient_id", "habit_id" },
                unique: true,
                filter: "status = 'Active'");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "ix_challenges_unique_active",
                table: "challenges");
        }
    }
}
