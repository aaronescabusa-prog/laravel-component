<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Storage;

class CertificateTemplate extends Model
{
    protected $fillable = [
        'event',
        'name',
        'path',
        'width',
        'height',
    ];

    /**
     * Expose the artwork URL in API responses.
     *
     * url() is an ordinary method, so without this it stays server-side only and
     * a client asking for /api/certificates/templates receives the path but no
     * way to resolve it - which is what the template preview needs in order to
     * display the uploaded image.
     */
    protected $appends = [
        'url',
    ];

    protected function casts(): array
    {
        return [
            'width' => 'integer',
            'height' => 'integer',
        ];
    }

    /**
     * Absolute path to the uploaded artwork, or null when the file is gone.
     */
    public function absolutePath(): ?string
    {
        return Storage::disk('public')->exists($this->path)
            ? Storage::disk('public')->path($this->path)
            : null;
    }

    /**
     * Publicly reachable URL for the artwork.
     */
    public function url(): string
    {
        return Storage::disk('public')->url($this->path);
    }

    /**
     * Attribute accessor backing $appends.
     *
     * Eloquent only serialises an appended attribute when the get{Attribute}
     * convention is present, so this delegates to url() rather than duplicating
     * it and keeps one source of truth for the location.
     */
    public function getUrlAttribute(): string
    {
        return $this->url();
    }
}