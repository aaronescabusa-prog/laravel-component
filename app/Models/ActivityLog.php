<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

class ActivityLog extends Model
{
    use SoftDeletes;
    protected $fillable = [
        'reference',
        'timestamp',
        'user',
        'role',
        'category',
        'action',
        'details',
    ];

    public function getRouteKeyName(): string
    {
        return 'reference';
    }
}
