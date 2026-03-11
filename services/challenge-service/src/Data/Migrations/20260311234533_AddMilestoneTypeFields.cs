using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Winzy.ChallengeService.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddMilestoneTypeFields : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<double>(
                name: "baseline_consistency",
                table: "challenges",
                type: "double precision",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "completion_count",
                table: "challenges",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "custom_end_date",
                table: "challenges",
                type: "timestamptz",
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "custom_start_date",
                table: "challenges",
                type: "timestamptz",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "baseline_consistency",
                table: "challenges");

            migrationBuilder.DropColumn(
                name: "completion_count",
                table: "challenges");

            migrationBuilder.DropColumn(
                name: "custom_end_date",
                table: "challenges");

            migrationBuilder.DropColumn(
                name: "custom_start_date",
                table: "challenges");
        }
    }
}
