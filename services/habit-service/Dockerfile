FROM mcr.microsoft.com/dotnet/sdk:10.0-alpine AS build
WORKDIR /src

COPY shared/Winzy.Contracts/Winzy.Contracts.csproj shared/Winzy.Contracts/
COPY shared/Winzy.Common/Winzy.Common.csproj shared/Winzy.Common/
COPY services/habit-service/src/Winzy.HabitService.csproj services/habit-service/src/
COPY Directory.Build.props .
RUN dotnet restore services/habit-service/src/Winzy.HabitService.csproj

COPY shared/ shared/
COPY services/habit-service/src/ services/habit-service/src/
RUN dotnet publish services/habit-service/src/Winzy.HabitService.csproj -c Release -o /app/publish

FROM mcr.microsoft.com/dotnet/aspnet:10.0-alpine AS runtime
WORKDIR /app
COPY --from=build /app/publish .
ENTRYPOINT ["dotnet", "Winzy.HabitService.dll"]
