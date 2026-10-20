"""Provider-independent bridge for the external mail ingestion (Python stdlib)."""
import json
import os
import urllib.error
import urllib.parse
import urllib.request


def relay_request(path, payload=None):
    base = os.environ['RELAY_API_URL'].rstrip('/')
    parsed = urllib.parse.urlsplit(base)
    if parsed.scheme != 'https' and not (
        parsed.scheme == 'http' and parsed.hostname in ('localhost', '127.0.0.1')
    ):
        raise ValueError('Use HTTPS outside local development')
    request = urllib.request.Request(
        base + '/api' + path,
        data=None if payload is None else json.dumps(payload).encode('utf-8'),
        headers={
            'Authorization': 'Bearer ' + os.environ['RELAY_API_KEY'],
            'Content-Type': 'application/json',
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        # Do not log credentials or email content. Caller handles retries/checkpoints.
        raise RuntimeError(f'Relay API returned HTTP {error.code}') from None


def send_email(email_payload):
    """Import mail only (no classification). Use stable mailboxId + externalId on retries."""
    return relay_request('/ingest', email_payload)


def get_classification_config():
    return {'skills': relay_request('/skills'), 'examples': relay_request('/examples')}


if __name__ == '__main__':
    import sys
    result = send_email(json.load(sys.stdin))
    print(json.dumps(result))
