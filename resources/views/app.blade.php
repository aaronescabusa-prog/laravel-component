<!doctype html>
<html lang="en">
    <head>
        <meta charset="UTF-8" />
        {{-- Where the app is mounted. XAMPP serves C:\xampp\htdocs as the document
             root, so this app lives at /laravel-component/public rather than at
             "/". The SPA reads this to prefix its API calls and its router base,
             otherwise it would call /api on the server root and get a 404.
             A meta tag (rather than an inline script) keeps it working under the
             production Content-Security-Policy, which sets script-src 'self'. --}}
        <meta name="app-base" content="{{ rtrim(request()->getBaseUrl(), '/') }}" />
        <link rel="icon" type="image/svg+xml" href="{{ asset('favicon.svg') }}" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta name="theme-color" content="#0b1628" />
        <meta name="color-scheme" content="light" />
        <meta
            name="description"
            content="TMC EventEase — the official event management platform of Trinidad Municipal College."
        />
        <title>TMC EventEase · Event Management System</title>
        @viteReactRefresh
        @vite('resources/js/main.jsx')
    </head>
    <body>
        <div id="root"></div>
    </body>
</html>