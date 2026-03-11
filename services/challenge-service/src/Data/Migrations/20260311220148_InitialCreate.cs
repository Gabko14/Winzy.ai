using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Winzy.ChallengeService.Data.Migrations
{
    /// <inheritdoc />
    public partial class InitialCreate : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "challenges",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false, defaultValueSql: "gen_random_uuid()"),
                    habit_id = table.Column<Guid>(type: "uuid", nullable: false),
                    creator_id = table.Column<Guid>(type: "uuid", nullable: false),
                    recipient_id = table.Column<Guid>(type: "uuid", nullable: false),
                    milestone_type = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    target_value = table.Column<double>(type: "double precision", nullable: false),
                    period_days = table.Column<int>(type: "integer", nullable: false),
                    reward_description = table.Column<string>(type: "character varying(512)", maxLength: 512, nullable: false),
                    status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    current_progress = table.Column<double>(type: "double precision", nullable: false),
                    ends_at = table.Column<DateTimeOffset>(type: "timestamptz", nullable: false),
                    completed_at = table.Column<DateTimeOffset>(type: "timestamptz", nullable: true),
                    claimed_at = table.Column<DateTimeOffset>(type: "timestamptz", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamptz", nullable: false, defaultValueSql: "now()"),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamptz", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_challenges", x => x.id);
                });

            migrationBuilder.CreateIndex(
                name: "ix_challenges_creator_id",
                table: "challenges",
                column: "creator_id");

            migrationBuilder.CreateIndex(
                name: "ix_challenges_habit_id",
                table: "challenges",
                column: "habit_id");

            migrationBuilder.CreateIndex(
                name: "ix_challenges_recipient_id",
                table: "challenges",
                column: "recipient_id");

            migrationBuilder.CreateIndex(
                name: "ix_challenges_recipient_id_status",
                table: "challenges",
                columns: new[] { "recipient_id", "status" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "challenges");
        }
    }
}
