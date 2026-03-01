FROM mcr.microsoft.com/dotnet/sdk:10.0-alpine AS build
WORKDIR /src

COPY shared/Winzy.Contracts/Winzy.Contracts.csproj shared/Winzy.Contracts/
COPY shared/Winzy.Common/Winzy.Common.csproj shared/Winzy.Common/
COPY services/notification-service/src/Winzy.NotificationService.csproj services/notification-service/src/
COPY Directory.Build.props .
RUN dotnet restore services/notification-service/src/Winzy.NotificationService.csproj

COPY shared/ shared/
COPY services/notification-service/src/ services/notification-service/src/
RUN dotnet publish services/notification-service/src/Winzy.NotificationService.csproj -c Release -o /app/publish

FROM mcr.microsoft.com/dotnet/aspnet:10.0-alpine AS runtime
WORKDIR /app
COPY --from=build /app/publish .
ENTRYPOINT ["dotnet", "Winzy.NotificationService.dll"]
