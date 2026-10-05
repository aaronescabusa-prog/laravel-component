<?php

namespace App\Models;

use Illuminate\Auth\Authenticatable as AuthenticatableTrait;
use Illuminate\Contracts\Auth\Authenticatable as AuthenticatableContract;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Support\Facades\Cache;
use Laravel\Sanctum\HasApiTokens;

class UserAccount extends Model implements AuthenticatableContract
{
    use AuthenticatableTrait, HasApiTokens, SoftDeletes;

    /**
     * Cache key holding the last verified status of an account, shared with
     * the EnsureAccountIsActive middleware.
     */
    public const STATUS_CACHE_KEY = 'account-status:';

    protected $fillable = [
        'reference',
        'name',
        'email',
        'role',
        'status',
        'course',
        'block_no',
        'year',
        'date',
        'password',
    ];

    protected $hidden = [
        'password',
    ];

    public function getRouteKeyName(): string
    {
        return 'reference';
    }

    protected function casts(): array
    {
        return [
            'password' => 'hashed',
        ];
    }

    /**
     * Drop the cached status whenever it changes, so a suspension takes effect
     * on the account's very next request instead of after the cache window.
     */
    protected static function booted(): void
    {
        static::saved(function (self $account): void {
            if ($account->wasChanged('status')) {
                static::forgetCachedStatus($account->getKey());
            }
        });

        static::deleted(function (self $account): void {
            static::forgetCachedStatus($account->getKey());
        });
    }

    /**
     * Forget the cached status for an account.
     */
    public static function forgetCachedStatus(int|string|null $key): void
    {
        if ($key !== null) {
            Cache::forget(self::STATUS_CACHE_KEY.$key);
        }
    }
}
