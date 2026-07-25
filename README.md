# Tournament App — Table Tennis Club

## Структура
```
tournament-app/
├── server.js              ← бэкенд (Node.js + Express + SQLite)
├── package.json
├── public/
│   ├── Главная.html
│   ├── Игроки.html
│   ├── Игрок.html
│   ├── Новый_игрок.html
│   ├── Турниры.html
│   ├── Управление_турниром.html
│   ├── api.js             ← общий слой работы с сервером
│   └── assets/            ← иконки и логотип (добавьте вручную)
└── data.db                ← создаётся автоматически при первом запуске
```

## Локальный запуск
```bash
npm install
npm start
# → http://localhost:3000
```

## Деплой на Railway

1. Создайте репозиторий на GitHub и загрузите все файлы
2. На railway.app: New Project → Deploy from GitHub → выберите репозиторий
3. Railway автоматически определит Node.js и запустит `npm start`
4. Получите URL вида: https://ваш-проект.railway.app

## Важно: папка assets
Добавьте в папку `public/assets/` следующие файлы:
- Logo.svg
- icon-players.svg
- icon-tournament.svg
- icon-delete.svg
- icon-racket.svg
- icon-star.svg
