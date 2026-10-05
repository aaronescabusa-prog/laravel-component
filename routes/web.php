<?php

use Illuminate\Support\Facades\Route;

Route::get('/login', function () {
    return view('app');
})->name('login');

Route::get('/{any?}', function (string $any = '') {
    if ($any === 'api' || str_starts_with($any, 'api/') || str_starts_with($any, 'sanctum')) {
        abort(404);
    }

    return view('app');
})->where('any', '.*');
