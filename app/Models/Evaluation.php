<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

class Evaluation extends Model
{
    use SoftDeletes;
    protected $fillable = [
        'reference',
        'event',
        'participant',
        'rating',
        'comment',
        'date',
    ];

    public function getRouteKeyName(): string
    {
        return 'reference';
    }

    protected function casts(): array
    {
        return [
            'rating' => 'integer',
        ];
    }
}
