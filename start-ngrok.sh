#!/bin/bash

echo "🚀 Setting up ngrok for Watch Party..."
echo ""

# Check if ngrok is installed
if ! command -v ngrok &> /dev/null; then
    echo "❌ ngrok is not installed. Please install it first:"
    echo "   brew install ngrok"
    exit 1
fi

# Kill any existing ngrok processes
pkill ngrok 2>/dev/null
sleep 2

echo "📋 STEP 1: Start your applications first"
echo "   Terminal 1: cd server && npm start"
echo "   Terminal 2: cd client && npm start"
echo ""
echo "📋 STEP 2: Choose ngrok setup method:"
echo "   1) Single tunnel (easier, uses one ngrok URL)"
echo "   2) Dual tunnel (advanced, separate URLs for client/server)"
echo ""

read -p "Choose option (1 or 2): " choice

if [ "$choice" = "1" ]; then
    echo ""
    echo "🌐 Starting single ngrok tunnel for client (port 3000)..."
    echo "⚠️  NOTE: You'll need to manually set the server URL in the browser"
    
    ngrok http 3000
    
elif [ "$choice" = "2" ]; then
    echo ""
    echo "🌐 Starting dual ngrok tunnels..."
    
    # Start client tunnel
    echo "📱 Starting client tunnel (port 3000)..."
    ngrok http 3000 > /tmp/ngrok-client.log 2>&1 &
    CLIENT_PID=$!
    
    # Start server tunnel  
    echo "🖥️  Starting server tunnel (port 3001)..."
    ngrok http 3001 > /tmp/ngrok-server.log 2>&1 &
    SERVER_PID=$!
    
    echo "⏳ Waiting for tunnels to initialize..."
    sleep 5
    
    # Get URLs from ngrok API
    echo ""
    echo "🔗 Your ngrok URLs:"
    
    curl -s localhost:4040/api/tunnels | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    for tunnel in data['tunnels']:
        addr = tunnel['config']['addr']
        public_url = tunnel['public_url']
        if '3000' in addr:
            print(f'📱 CLIENT:  {public_url}')
        elif '3001' in addr:
            print(f'🖥️  SERVER:  {public_url}')
except Exception as e:
    print('Error getting tunnel info. Check ngrok status manually.')
"
    
    echo ""
    echo "📋 Instructions:"
    echo "1. Share the CLIENT URL with your friends"
    echo "2. When prompted for server URL, provide the SERVER URL"
    echo ""
    echo "Press Ctrl+C to stop tunnels..."
    
    trap 'kill $CLIENT_PID $SERVER_PID 2>/dev/null; echo "🛑 Stopped tunnels"; exit' INT
    wait
    
else
    echo "❌ Invalid choice. Please run the script again."
    exit 1
fi