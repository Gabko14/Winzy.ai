using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Winzy.HabitService.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddFlamePromises : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "promises",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false, defaultValueSql: "gen_random_uuid()"),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    habit_id = table.Column<Guid>(type: "uuid", nullable: false),
                    target_consistency = table.Column<double>(type: "double precision", nullable: false),
                    end_date = table.Column<DateOnly>(type: "date", nullable: false),
                    private_note = table.Column<string>(type: "character varying(512)", maxLength: 512, nullable: true),
                    status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    resolved_at = table.Column<DateTimeOffset>(type: "timestamptz", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamptz", nullable: false, defaultValueSql: "now()"),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamptz", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_promises", x => x.id);
                    table.ForeignKey(
                        name: "fk_promises_habits_habit_id",
                        column: x => x.habit_id,
                        principalTable: "habits",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_promises_habit_id",
                table: "promises",
                column: "habit_id");

            migrationBuilder.CreateIndex(
                name: "ix_promises_user_id",
                table: "promises",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "ix_promises_user_id_habit_id",
                table: "promises",
                columns: new[] { "user_id", "habit_id" },
                unique: true,
                filter: "status = 'Active'");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "promises");
        }
    }
}
