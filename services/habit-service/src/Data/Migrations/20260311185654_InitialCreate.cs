using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Winzy.HabitService.Data.Migrations
{
    /// <inheritdoc />
    public partial class InitialCreate : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "habits",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false, defaultValueSql: "gen_random_uuid()"),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    icon = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    color = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    frequency = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    custom_days = table.Column<string>(type: "jsonb", nullable: true),
                    archived_at = table.Column<DateTimeOffset>(type: "timestamptz", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamptz", nullable: false, defaultValueSql: "now()"),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamptz", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_habits", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "completions",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false, defaultValueSql: "gen_random_uuid()"),
                    habit_id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    completed_at = table.Column<DateTimeOffset>(type: "timestamptz", nullable: false),
                    local_date = table.Column<DateOnly>(type: "date", nullable: false),
                    note = table.Column<string>(type: "character varying(512)", maxLength: 512, nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamptz", nullable: false, defaultValueSql: "now()"),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamptz", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_completions", x => x.id);
                    table.ForeignKey(
                        name: "fk_completions__habits_habit_id",
                        column: x => x.habit_id,
                        principalTable: "habits",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_completions_habit_id_local_date",
                table: "completions",
                columns: new[] { "habit_id", "local_date" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_completions_user_id",
                table: "completions",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "ix_habits_user_id",
                table: "habits",
                column: "user_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "completions");

            migrationBuilder.DropTable(
                name: "habits");
        }
    }
}
