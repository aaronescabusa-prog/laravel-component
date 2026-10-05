<p align="center"><a href="https://laravel.com" target="_blank"><img src="https://raw.githubusercontent.com/laravel/art/master/logo-lockup/5%20SVG/2%20CMYK/1%20Full%20Color/laravel-logolockup-cmyk-red.svg" width="400" alt="Laravel Logo"></a></p>

<p align="center">
<a href="https://github.com/laravel/framework/actions"><img src="https://github.com/laravel/framework/workflows/tests/badge.svg" alt="Build Status"></a>
<a href="https://packagist.org/packages/laravel/framework"><img src="https://img.shields.io/packagist/dt/laravel/framework" alt="Total Downloads"></a>
<a href="https://packagist.org/packages/laravel/framework"><img src="https://img.shields.io/packagist/v/laravel/framework" alt="Latest Stable Version"></a>
<a href="https://packagist.org/packages/laravel/framework"><img src="https://img.shields.io/packagist/l/laravel/framework" alt="License"></a>
</p>

## About Laravel

Laravel is a web application framework with expressive, elegant syntax. We believe development must be an enjoyable and creative experience to be truly fulfilling. Laravel takes the pain out of development by easing common tasks used in many web projects, such as:

- [Simple, fast routing engine](https://laravel.com/docs/routing).
- [Powerful dependency injection container](https://laravel.com/docs/container).
- Multiple back-ends for [session](https://laravel.com/docs/session) and [cache](https://laravel.com/docs/cache) storage.
- Expressive, intuitive [database ORM](https://laravel.com/docs/eloquent).
- Database agnostic [schema migrations](https://laravel.com/docs/migrations).
- [Robust background job processing](https://laravel.com/docs/queues).
- [Real-time event broadcasting](https://laravel.com/docs/broadcasting).

Laravel is accessible, powerful, and provides tools required for large, robust applications.

## Learning Laravel

Laravel has the most extensive and thorough [documentation](https://laravel.com/docs) and video tutorial library of all modern web application frameworks, making it a breeze to get started with the framework.

In addition, [Laracasts](https://laracasts.com) contains thousands of video tutorials on a range of topics including Laravel, modern PHP, unit testing, and JavaScript. Boost your skills by digging into our comprehensive video library.

You can also watch bite-sized lessons with real-world projects on [Laravel Learn](https://laravel.com/learn), where you will be guided through building a Laravel application from scratch while learning PHP fundamentals.

## Agentic Development

Laravel's predictable structure and conventions make it ideal for AI coding agents like Claude Code, Cursor, and GitHub Copilot. Install [Laravel Boost](https://laravel.com/docs/ai) to supercharge your AI workflow:

```bash
composer require laravel/boost --dev

php artisan boost:install
```

Boost provides your agent 15+ tools and skills that help agents build Laravel applications while following best practices.

## Security

This project ships with a hardened configuration. Keep the following in mind when
deploying or debugging.

### What is already in place

| Control | Where |
| --- | --- |
| Auth on every data route (`auth:sanctum` + `role:`) | `routes/api.php`, `app/Http/Middleware/EnsureRole.php` |
| Login throttled to 5 attempts/min, registration to 3/min | `app/Providers/AppServiceProvider.php`, `routes/api.php` |
| Bearer tokens expire after `SANCTUM_TOKEN_EXPIRATION` minutes (default 24h) | `config/sanctum.php` |
| Changing a password revokes every other token | `app/Http/Controllers/Api/SettingsController.php` |
| Only administrators may create Admin accounts or reset another user's password | `app/Http/Controllers/Api/UserAccountController.php` |
| Self-registration may request Student, Organizer or Staff — never Admin, and the account stays Pending | `app/Http/Controllers/Api/AuthController.php` |
| Audit entries take the actor and timestamp from the session, never the request body | `app/Http/Controllers/Api/ActivityLogController.php` |
| Encrypted sessions, bcrypt cost 12, password never serialised | `.env`, `config/session.php`, `app/Models/UserAccount.php` |
| Security headers (nosniff, X-Frame-Options, Referrer-Policy, CSP, HSTS over TLS) | `app/Http/Middleware/SecurityHeaders.php` |
| Direct HTTP access to `.env`, `storage/`, `database/`, `vendor/`… blocked | `.htaccess` |

### Local development notes

- `APP_DEBUG=false` is the default. Turn it on temporarily when you need a stack
  trace, but never on a machine other people can reach: debug pages print
  environment variables and SQL.
- The `Content-Security-Policy` is deliberately reduced while `APP_ENV=local`,
  because the Vite dev server needs inline scripts and a websocket on :5173. The
  strict policy (script-src 'self', connect-src 'self', …) applies everywhere else.
- XAMPP serves `htdocs` as its document root, so this project is not mounted at
  the server root. Open `http://localhost/laravel-component/`; the root
  `index.php` forwards to `public/`, which is where Laravel is really served
  from. The root `.htaccess` continues to deny `.env`, `storage/`, `vendor/` and
  friends (403).
- Because the app lives in a sub-directory, `app.blade.php` renders a
  `<meta name="app-base">` tag with its mount point (`/laravel-component/public`)
  and the SPA uses it for its API calls and its router `basename`. Without that
  tag the frontend would request `/api` on the *server* root and get a 404.
  Served at the document root (`php artisan serve`, or a virtual host) the tag
  is empty and the frontend behaves exactly as before.
- **Apache must run PHP >= 8.4.1.** XAMPP bundles PHP 8.2, under which every
  request dies in `vendor/composer/platform_check.php`, so Apache is pointed at
  the standalone PHP 8.5 in `C:\php_new` instead
  (`apache/conf/extra/httpd-xampp.conf`, original kept as
  `httpd-xampp.conf.bak-php85`). `C:\php_new\php.ini` must also load `mysqli`,
  which phpMyAdmin needs, and allow uploads large enough for certificate
  templates. Copy the backup back over the live file to undo this.
- `bind-address=127.0.0.1` was added to `xampp/mysql/bin/my.ini`. **Restart MySQL
  from the XAMPP Control Panel** for it to take effect. Giving the MySQL `root`
  account a password is also recommended; `AllowNoPassword` in
  `xampp/phpMyAdmin/config.inc.php` must be updated at the same time.

### Production checklist

- `APP_ENV=production`, `APP_DEBUG=false`, and a fresh `php artisan key:generate`
  (rotating the key invalidates existing sessions).
- `SESSION_SECURE_COOKIE=true` and serve the application over HTTPS only.
- `composer install --no-dev --optimize-autoloader` and `php artisan config:cache`.
- Point the web server's document root at `public/`.
- Give the application its own MySQL user with a strong password instead of `root`.
- Run `php artisan test` before deploying.

## Contributing

Thank you for considering contributing to the Laravel framework! The contribution guide can be found in the [Laravel documentation](https://laravel.com/docs/contributions).

## Code of Conduct

In order to ensure that the Laravel community is welcoming to all, please review and abide by the [Code of Conduct](https://laravel.com/docs/contributions#code-of-conduct).

## Security Vulnerabilities

If you discover a security vulnerability within Laravel, please send an e-mail to Taylor Otwell via [taylor@laravel.com](mailto:taylor@laravel.com). All security vulnerabilities will be promptly addressed.

## License

The Laravel framework is open-sourced software licensed under the [MIT license](https://opensource.org/licenses/MIT).
