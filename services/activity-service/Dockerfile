FROM mcr.microsoft.com/dotnet/sdk:10.0-alpine AS build
WORKDIR /src

COPY shared/Winzy.Contracts/Winzy.Contracts.csproj shared/Winzy.Contracts/
COPY shared/Winzy.Common/Winzy.Common.csproj shared/Winzy.Common/
COPY services/activity-service/src/Winzy.ActivityService.csproj services/activity-service/src/
COPY Directory.Build.props global.json ./
RUN dotnet restore services/activity-service/src/Winzy.ActivityService.csproj

COPY shared/ shared/
COPY services/activity-service/src/ services/activity-service/src/
RUN dotnet publish services/activity-service/src/Winzy.ActivityService.csproj -c Release -o /app/publish

FROM mcr.microsoft.com/dotnet/aspnet:10.0-alpine AS runtime
WORKDIR /app
COPY --from=build /app/publish .
ENTRYPOINT ["dotnet", "Winzy.ActivityService.dll"]
