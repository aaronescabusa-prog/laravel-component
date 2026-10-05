<?php

declare(strict_types=1);

/*
 * Project-root entry point.
 *
 * XAMPP serves all of C:\xampp\htdocs, so this project is reachable at
 * /laravel-component/ rather than at a document root of its own. Without a
 * file here Apache has nothing to serve for "/laravel-component/" and, because
 * the root .htaccess turns directory listings off, answers 403.
 *
 * Laravel's real front controller is public/index.php, so this file does not
 * bootstrap the application. It only forwards the visitor to public/ and keeps
 * the hardened root .htaccess rules in charge of what is reachable here.
 *
 * The redirect is relative on purpose, so the project works unchanged whether
 * it is opened via http://localhost/laravel-component/ or through a virtual
 * host on any other host name.
 */

$query = (string) ($_SERVER['QUERY_STRING'] ?? '');

header('Location: public/' . ($query !== '' ? '?' . $query : ''), true, 302);
exit;