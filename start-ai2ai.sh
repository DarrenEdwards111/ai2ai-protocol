#!/bin/bash
# Start AI2AI servers for both agents
# Usage: ./start-ai2ai.sh [darren|alex]
#
# Runs as foreground process. Ctrl+C stops both.
# For background: ./start-ai2ai.sh &

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "🦞 AI2AI Multi-Agent Startup"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Check if ports are already in use
check_port() {
    local port=$1
    local name=$2
    if ss -tlnp 2>/dev/null | grep -q ":${port} " || lsof -ti:${port} >/dev/null 2>&1; then
        echo "⚠️  Port ${port} (${name}) already in use!"
        echo "   Kill existing process: kill \$(lsof -ti:${port})"
        return 1
    fi
    return 0
}

# Function to start a single agent
start_agent() {
    local name=$1
    local port=$2
    local skill_dir=$3
    
    echo "🚀 Starting ${name}'s server on port ${port}..."
    
    # Ensure directories
    mkdir -p "${skill_dir}/.keys" "${skill_dir}/pending" "${skill_dir}/conversations" \
             "${skill_dir}/logs" "${skill_dir}/outbox"
    
    AI2AI_PORT=${port} \
    AI2AI_AGENT_NAME="${name,,}-assistant" \
    AI2AI_HUMAN_NAME="${name}" \
    AI2AI_TIMEZONE="Europe/London" \
    node "${skill_dir}/ai2ai-server.js" &
    
    echo "   PID: $!"
}

DARREN_SKILL="/home/darre/.openclaw/workspace/skills/ai2ai"
ALEX_SKILL="/home/darre/.openclaw/workspace-alex/skills/ai2ai"

case "${1:-all}" in
    darren)
        check_port 18810 "Darren" || exit 1
        start_agent "Darren" 18810 "$DARREN_SKILL"
        ;;
    alex)
        check_port 18811 "Alex" || exit 1
        AI2AI_TIMEZONE="America/New_York" start_agent "Alex" 18811 "$ALEX_SKILL"
        ;;
    all|"")
        check_port 18810 "Darren" || exit 1
        check_port 18811 "Alex" || exit 1
        start_agent "Darren" 18810 "$DARREN_SKILL"
        AI2AI_TIMEZONE="America/New_York" start_agent "Alex" 18811 "$ALEX_SKILL"
        ;;
    stop)
        echo "🛑 Stopping AI2AI servers..."
        pkill -f "AI2AI_PORT=1881[01]" 2>/dev/null
        # Also try killing by port
        for port in 18810 18811; do
            pid=$(lsof -ti:${port} 2>/dev/null)
            if [ -n "$pid" ]; then
                kill "$pid" 2>/dev/null && echo "   Killed PID $pid (port $port)"
            fi
        done
        echo "Done."
        exit 0
        ;;
    status)
        echo "Checking AI2AI servers..."
        for port in 18810 18811; do
            if curl -s "http://localhost:${port}/ai2ai/health" >/dev/null 2>&1; then
                result=$(curl -s "http://localhost:${port}/ai2ai/health")
                echo "  ✅ Port ${port}: ${result}"
            else
                echo "  ❌ Port ${port}: offline"
            fi
        done
        exit 0
        ;;
    *)
        echo "Usage: $0 [darren|alex|all|stop|status]"
        exit 1
        ;;
esac

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Darren: http://localhost:18810/ai2ai"
echo "Alex:   http://localhost:18811/ai2ai"
echo ""
echo "Press Ctrl+C to stop."

# Wait for children
wait
