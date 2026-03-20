using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Winzy.SocialService.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddWitnessLinks : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "witness_links",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false, defaultValueSql: "gen_random_uuid()"),
                    owner_id = table.Column<Guid>(type: "uuid", nullable: false),
                    token = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    label = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    revoked_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamptz", nullable: false, defaultValueSql: "now()"),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamptz", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_witness_links", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "witness_link_habits",
                columns: table => new
                {
                    witness_link_id = table.Column<Guid>(type: "uuid", nullable: false),
                    habit_id = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_witness_link_habits", x => new { x.witness_link_id, x.habit_id });
                    table.ForeignKey(
                        name: "fk_witness_link_habits_witness_links_witness_link_id",
                        column: x => x.witness_link_id,
                        principalTable: "witness_links",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_witness_link_habits_witness_link_id",
                table: "witness_link_habits",
                column: "witness_link_id");

            migrationBuilder.CreateIndex(
                name: "ix_witness_links_owner_id",
                table: "witness_links",
                column: "owner_id");

            migrationBuilder.CreateIndex(
                name: "ix_witness_links_token",
                table: "witness_links",
                column: "token",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "witness_link_habits");

            migrationBuilder.DropTable(
                name: "witness_links");
        }
    }
}
