import { Global, Module } from '@nestjs/common';
import { CONFIG_SERVICE } from './config.interfaces';
import { ConfigService } from './config.service';

/**
 * Global so any other module can `@Inject(CONFIG_SERVICE)` without importing
 * ConfigModule itself, once the integrator wires it into the real
 * AppModule. That's what keeps this slice independently mergeable — other
 * slices (auth, models, chat-completions) are built against the
 * CONFIG_SERVICE token without depending on this module directly.
 */
@Global()
@Module({
  providers: [{ provide: CONFIG_SERVICE, useClass: ConfigService }],
  exports: [CONFIG_SERVICE],
})
export class ConfigModule {}
