# Project Vision

## Problem
Getting accountability for daily habits is socially awkward. Asking someone "will you be my accountability partner?" creates friction and feels weird. As a result, most people track habits in isolation, missing out on the support and motivation that comes from their social circle.

## Target User
Self-improvement oriented people who already use habit trackers. They understand the value of consistent habits and accountability, but want a more natural way to get social support without the awkwardness of explicitly asking for it.

## Success Metric
Users who connect with friends have higher habit consistency than solo users. Friends actively engage by viewing progress and setting experience-based challenges.

## Why Software?
A standalone habit tracker with an optional social layer removes friction that manual accountability creates. Instead of texting updates or formally asking for accountability partners, users simply share their tracker with friends who can passively observe or actively support. The social connection happens naturally within the tool they already use daily.

---

## Core Philosophy
- **Habit tracker first**: Works beautifully as a standalone minimalistic tracker. No friends required.
- **Social layer is optional**: Friends can see your progress and set challenges, but it's an enhancement, not a dependency.
- **Reduce friction, don't add features**: The value is making accountability natural, not adding gamification.
- **Shared experiences, not transactions**: Challenge rewards are things you do TOGETHER (play tennis, grab coffee, go hiking) — not gifts one person gives another. The reward IS the connection.

## Design Principles
- **Clean and minimal**: Pleasant to look at, not confusing. Not childish (Habitica), not corporate. A tool that feels calm.
- **Encourage, never punish**: No guilt-tripping language. Missing a day is OK. The app celebrates progress, not perfection.
- **Consistency over streaks**: Streaks create all-or-nothing anxiety. We measure consistency over a 60-day rolling window — progress you can feel good about even when imperfect.
- **The Flame**: Visual representation of consistency. A small ember at 0%, growing to a blazing flame at 100%. It grows quickly with improvement, shrinks slowly with misses. You're never "at zero" — even a tiny ember means you're still here.
- **Supportive notifications**: "Ready to log today?" not "You haven't logged today!" The tone is a supportive friend, not a disappointed parent.

## Product Strategy
- **Web-first MVP**: Ship a web app to validate the concept quickly. Mobile-first responsive design — optimized for phones, works on desktop.
- **PWA**: "Add to Home Screen" for a native-like experience without app stores.
- **Native apps later**: iOS/Android only after the web MVP proves people want this.
- **Same codebase**: Using Expo so the web code can become native mobile apps with minimal changes.
