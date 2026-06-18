import os
import sys
import paramiko
import getpass

# --- Server Configuration ---
# Replace these with your server's details.
# It's better to use environment variables or a config file for sensitive data.
HOSTNAME = "1ink.us"
PORT = 22  # Default SFTP/SSH port
USERNAME = "ford442"

# --- Project Configuration ---
# The local directory to upload from.
LOCAL_DIRECTORY = "build"
# The directory on the server where the files should go (e.g., 'public_html/wasm-game').
REMOTE_DIRECTORY = "go.1ink.us/streetview"

def _validate_build():
    """Reject obviously broken build/ output before uploading."""
    index_html = os.path.join(LOCAL_DIRECTORY, "index.html")
    if not os.path.isfile(index_html):
        print(f"Error: {index_html} not found. Run 'npm run build' first.")
        sys.exit(1)

    with open(index_html, encoding="utf-8", errors="replace") as f:
        content = f.read()

    problems = []
    if "%PUBLIC_URL%" in content:
        problems.append("index.html still has %PUBLIC_URL% — you may have uploaded public/ instead of build/")
    if "static/js/main" not in content:
        problems.append("index.html does not reference static/js/main.*.js")

    if problems:
        print("\nERROR: build/ is not safe to deploy:")
        for p in problems:
            print(f"  - {p}")
        print("\nFix: npm run build  (then re-run this script)\n")
        sys.exit(1)

    print("build/index.html looks valid.")

    print(
        "\nNOTE: Prefer the maintained deploy path for go.1ink.us:\n"
        "  MAPS_API_KEY=your_key DEPLOY_TARGET=go python deploy.py\n"
        "deploy_old.py uploads build/ as-is (no key injection, no Cesium post-build patches).\n"
    )

def upload_directory(sftp_client, local_path, remote_path):
    """
    Recursively uploads a directory and its contents to the remote server.
    """
    print(f"Creating remote directory: {remote_path}")
    try:
        # Create the target directory on the server if it doesn't exist.
        sftp_client.mkdir(remote_path)
    except IOError:
        # Directory already exists, which is fine.
        print(f"Directory {remote_path} already exists.")

    for item in os.listdir(local_path):
        local_item_path = os.path.join(local_path, item)
        remote_item_path = f"{remote_path}/{item}"

        if os.path.isfile(local_item_path):
            print(f"Uploading file: {local_item_path} -> {remote_item_path}")
            sftp_client.put(local_item_path, remote_item_path)
        elif os.path.isdir(local_item_path):
            # If it's a directory, recurse into it.
            upload_directory(sftp_client, local_item_path, remote_item_path)

def main():
    """
    Main function to connect to the server and start the upload process.
    """
    password = 'GoogleBez12!' # getpass.getpass(f"Enter password for {USERNAME}@{HOSTNAME}: ")

    transport = None
    sftp = None
    try:
        # Establish the SSH connection
        transport = paramiko.Transport((HOSTNAME, PORT))
        print("Connecting to server...")
        transport.connect(username=USERNAME, password=password)
        print("Connection successful!")

        # Create an SFTP client from the transport
        sftp = paramiko.SFTPClient.from_transport(transport)
        print(f"Starting upload of '{LOCAL_DIRECTORY}' to '{REMOTE_DIRECTORY}'...")

        # Start the recursive upload
        upload_directory(sftp, LOCAL_DIRECTORY, REMOTE_DIRECTORY)

        print("\n✅ Deployment complete!")

    except Exception as e:
        print(f"❌ An error occurred: {e}")
    finally:
        # Ensure the connection is closed
        if sftp:
            sftp.close()
        if transport:
            transport.close()
        print("Connection closed.")

if __name__ == "__main__":
    if not os.path.exists(LOCAL_DIRECTORY):
        print(f"Error: Local directory '{LOCAL_DIRECTORY}' not found. Did you run 'npm run build' first?")
    else:
        _validate_build()
        main()
