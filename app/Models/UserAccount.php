<?php

namespace App\Models;

use Illuminate\Auth\Authenticatable as AuthenticatableTrait;
use Illuminate\Auth\Passwords\CanResetPassword;
use Illuminate\Contracts\Auth\Authenticatable as AuthenticatableContract;
use Illuminate\Contracts\Auth\CanResetPassword as CanResetPasswordContract;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Notifications\Notifiable;
use Illuminate\Support\Facades\Cache;
use Laravel\Sanctum\HasApiTokens;
use App\Support\AcademicStructure;

class UserAccount extends Model implements AuthenticatableContract, CanResetPasswordContract
{
    use AuthenticatableTrait, CanResetPassword, HasApiTokens, Notifiable, SoftDeletes;

    /**
     * Cache key holding the last verified status of an account, shared with
     * the EnsureAccountIsActive middleware.
     */
    public const STATUS_CACHE_KEY = 'account-status:';

    protected $fillable = [
        'reference',
        'student_id',
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
        'attendance_qr_token',
    ];

    protected $appends = [
        'department',
        'department_name',
    ];

    public function getDepartmentAttribute(): ?string
    {
        return AcademicStructure::departmentCodeForCourse($this->course);
    }

    public function getDepartmentNameAttribute(): ?string
    {
        return AcademicStructure::departmentName($this->department);
    }

    public function scannerEvents(): BelongsToMany
    {
        return $this->belongsToMany(Event::class, 'event_scanners')
            ->withPivot('assigned_by')
            ->withTimestamps();
    }

    public function attendanceObligations(): HasMany
    {
        return $this->hasMany(EventObligation::class, 'user_account_id');
    }

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
        static::creating(function (self $account): void {
            if (blank($account->attendance_qr_token)) {
                $account->attendance_qr_token = bin2hex(random_bytes(24));
            }
        });

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
