<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Setting extends Model
{
    protected $fillable = [
        'key',
        'value',
    ];

    public static function allAsArray(): array
    {
        return static::all(['key', 'value'])
            ->mapWithKeys(fn (Setting $setting) => [
                $setting->key => $setting->decode($setting->value),
            ])
            ->all();
    }

    public static function set(string $key, mixed $value): void
    {
        static::updateOrCreate(
            ['key' => $key],
            ['value' => static::encode($value)],
        );
    }

    public static function value(string $key, mixed $default = null): mixed
    {
        $setting = static::where('key', $key)->value('value');

        return $setting === null ? $default : static::decode($setting);
    }

    private static function encode(mixed $value): string
    {
        return json_encode($value) ?: '';
    }

    private static function decode(string $encoded): mixed
    {
        $value = json_decode($encoded, true);

        return json_last_error() === JSON_ERROR_NONE ? $value : $encoded;
    }
}