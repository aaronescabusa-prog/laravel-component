<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

class Announcement extends Model
{
    use SoftDeletes;
    protected $fillable = [
        'reference',
        'title',
        'message',
        'audience',
        'target_role',
        'target_department',
        'target_course',
        'target_year',
        'target_block',
        'category',
        'status',
        'publish_date',
        'author',
    ];

    public function getRouteKeyName(): string
    {
        return 'reference';
    }

    protected function casts(): array
    {
        return [
            'publish_date' => 'date:Y-m-d',
        ];
    }
}
