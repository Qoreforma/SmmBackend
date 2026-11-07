module.exports = {
    apps: [
        {
            name: 'Backend',
            script: './dist/server.js',
            cwd: '/var/www/paymintBackend',
            instances: 1,
            exec_mode: 'fork',
            node_args: '-r dotenv/config',
            env_production: {
                NODE_ENV: 'production',
                PORT: 5002,
                DOTENV_CONFIG_PATH: '.env'
            },

            error_file: './logs/err.log',
            out_file: './logs/out.log',
            log_file: '/dev/null',
            log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
            merge_logs: true,

            watch: false,
            ignore_watch: ['node_modules', 'logs', '.git'],

            max_memory_restart: '1G',

            autorestart: true,
            restart_delay: 4000,
            max_restarts: 10,
            min_uptime: '10s',

            kill_timeout: 5000,
            wait_ready: false,
            listen_timeout: 5000,
            shutdown_with_message: true,

            instance_var: 'INSTANCE_ID',
        }
    ],
};